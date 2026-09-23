"""Run with: python -m src.api --host 127.0.0.1 --port 8000."""
import argparse
import logging

from src.api.server import make_server


def main():
    parser = argparse.ArgumentParser(description='Local wind forecast dashboard API')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    with make_server(args.host, args.port) as server:
        print(f'Forecast API listening on http://{args.host}:{server.server_port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
