import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as LibreMap, MapMouseEvent } from "maplibre-gl";
import * as THREE from "three";
import type { TurbineId } from "../../domain/forecast";
import type { TurbineSite } from "../../domain/map";

function windmill() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f8ff, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x536477, roughness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x365ef6, roughness: 0.6 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 4, 78, 16), white);
  tower.position.y = 41;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(10, 11, 2, 32), dark);
  base.position.y = 1;
  const nacelle = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 12), white);
  nacelle.position.set(0, 81, -2);
  const rotor = new THREE.Group();
  rotor.position.set(0, 81, 5);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), accent);
  rotor.add(hub);
  const profile = new THREE.Shape();
  profile.moveTo(-1, 2); profile.lineTo(-2.8, 10); profile.lineTo(-1.4, 23);
  profile.lineTo(0.5, 37); profile.lineTo(1.3, 35); profile.lineTo(2.2, 10);
  profile.lineTo(1, 2); profile.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(profile, { depth: 0.7, bevelEnabled: false });
  for (let index = 0; index < 3; index++) {
    const blade = new THREE.Mesh(bladeGeometry, white);
    blade.rotation.z = index * Math.PI * 2 / 3 + 0.25;
    rotor.add(blade);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 1.1, 8, 48), accent);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.5;
  group.add(base, tower, nacelle, rotor, ring);
  return { group, ring };
}

export function createTurbineLayer(sites: TurbineSite[], onSelect: (id: TurbineId) => void) {
  const origin = MercatorCoordinate.fromLngLat(sites[0]?.coordinates ?? [0, 0]);
  const scale = origin.meterInMercatorCoordinateUnits();
  const modelMatrix = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(scale, -scale, scale)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const sunlight = new THREE.DirectionalLight(0xffffff, 3);
  sunlight.position.set(-100, 180, 100);
  scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x6a7668, 2), sunlight);
  const models = sites.map((site) => {
    const model = windmill();
    const position = MercatorCoordinate.fromLngLat(site.coordinates);
    model.group.position.set((position.x - origin.x) / scale, 0, (position.y - origin.y) / scale);
    model.group.traverse((object) => { object.userData.turbine = site.id; });
    scene.add(model.group);
    return { ...model, id: site.id };
  });
  let map: LibreMap | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  const raycaster = new THREE.Raycaster();
  const selectModel = (event: MapMouseEvent) => {
    if (!map || !renderer) return;
    const canvas = map.getCanvas();
    const x = event.point.x / canvas.clientWidth * 2 - 1;
    const y = 1 - event.point.y / canvas.clientHeight * 2;
    const near = new THREE.Vector3(x, y, -1).unproject(camera);
    const far = new THREE.Vector3(x, y, 1).unproject(camera);
    raycaster.set(near, far.sub(near).normalize());
    const hit = raycaster.intersectObjects(models.map((model) => model.group), true)[0];
    if (hit) onSelect(hit.object.userData.turbine as TurbineId);
  };
  const layer: CustomLayerInterface = {
    id: "wind-turbines", type: "custom", renderingMode: "3d",
    onAdd(instance, gl) {
      map = instance;
      renderer = new THREE.WebGLRenderer({ canvas: instance.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      instance.on("click", selectModel);
    },
    render(_gl, args) {
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(modelMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      renderer?.resetState();
      renderer?.render(scene, camera);
    },
    onRemove() {
      map?.off("click", selectModel);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer?.dispose();
      map = undefined;
    },
  };
  return { layer, select(id: TurbineId) {
    models.forEach((model) => { model.ring.visible = model.id === id; });
    map?.triggerRepaint();
  } };
}
