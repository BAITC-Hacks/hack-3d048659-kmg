"""Small local HTTP server; serve through the frontend's same-origin /api proxy."""
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
import re

from src.api.domain import InvalidRequest

MAX_BODY_BYTES = 2 * 1024 * 1024
LOGGER = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def default_service():
    from src.fleet.service import FleetService
    return FleetService()


def make_server(host='127.0.0.1', port=8000, service=None):
    service = service or default_service()

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def _respond(self, status, payload):
            encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
            try:
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(encoded)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                # A reload or cancelled fetch can close the socket before headers/body.
                # There is no peer left to receive an error response; the service succeeded.
                return

        def _dispatch(self, callback):
            try:
                self._respond(200, callback())
            except ApiError as error:
                self._respond(error.status, {'error': {'code': error.code, 'message': error.message}})
            except InvalidRequest as error:
                self._respond(422, {'error': {'code': error.code, 'message': error.message}})
            except Exception:
                LOGGER.exception('Forecast API request failed')
                self._respond(500, {'error': {'code': 'backend_error',
                              'message': 'The backend could not complete the request. See the server log.'}})

        def do_GET(self):
            def route():
                path = urlsplit(self.path).path
                if path == '/api/health':
                    return service.health() if hasattr(service, 'health') else {'status': 'ok'}
                if path == '/api/workspace':
                    return service.workspace()
                if path == '/api/calculations':
                    turbine = parse_qs(urlsplit(self.path).query).get('turbine', [None])[0]
                    return {'calculations': service.calculations(turbine)}
                job = re.fullmatch(r'/api/calculations/([a-zA-Z0-9_-]+)', path)
                if job:
                    return service.calculation(job[1])
                raise ApiError(404, 'not_found', 'API route not found.')
            self._dispatch(route)

        def do_POST(self):
            def route():
                path = urlsplit(self.path).path
                actuals = re.fullmatch(r'/api/turbines/([a-zA-Z0-9_-]+)/actuals', path)
                training = re.fullmatch(r'/api/turbines/([a-zA-Z0-9_-]+)/train', path)
                if path not in ('/api/forecasts', '/api/turbines') and not actuals and not training:
                    raise ApiError(404, 'not_found', 'API route not found.')
                origin = self.headers.get('Origin')
                if origin:
                    parsed = urlsplit(origin)
                    if parsed.scheme not in ('http', 'https') or parsed.netloc.lower() != self.headers.get('Host', '').lower():
                        raise ApiError(403, 'invalid_origin', 'Cross-origin requests are not accepted; use the frontend proxy.')
                if self.headers.get_content_type() != 'application/json':
                    raise ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.')
                if self.headers.get('Transfer-Encoding'):
                    raise ApiError(400, 'invalid_body', 'Transfer-Encoding is not supported.')
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    raise ApiError(400, 'invalid_body', 'Invalid Content-Length.') from None
                if length < 1 or length > MAX_BODY_BYTES:
                    raise ApiError(413, 'invalid_body_size', f'JSON body must be 1–{MAX_BODY_BYTES} bytes.')
                try:
                    payload = json.loads(self.rfile.read(length))
                except (ValueError, UnicodeError):
                    raise ApiError(400, 'invalid_json', 'Request body must contain valid JSON.') from None
                if path == '/api/turbines':
                    return service.create_turbine(payload)
                if actuals:
                    return service.import_actuals(actuals[1], payload)
                if training:
                    return service.queue_training(training[1], payload)
                return service.recalculate(payload)
            self._dispatch(route)

        def unsupported_method(self):
            self._respond(405, {'error': {'code': 'method_not_allowed',
                                       'message': 'Use GET or POST for this API.'}})

        do_OPTIONS = do_PUT = do_PATCH = do_DELETE = do_HEAD = unsupported_method

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server
