import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class OrderbookVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.bidBars = [];
    this.askBars = [];
    this.anomalyMarkers = [];
    this.gridHelper = null;
    this.axesHelper = null;
    this.showAnomalies = true;
    this.showAxes = true;
    this.autoRotate = false;
    this.currentOrderbook = null;
    this.currentAnomalies = [];
    this.priceRange = 50;
    this.maxQuantity = 1;
    
    this.colors = {
      bid: new THREE.Color(0x10b981),
      ask: new THREE.Color(0xef4444),
      anomalyWarning: new THREE.Color(0xf59e0b),
      anomalyCritical: new THREE.Color(0xec4899),
      grid: new THREE.Color(0x333355)
    };

    this.init();
  }

  init() {
    const container = this.canvas.parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.scene.fog = new THREE.Fog(0x0a0a1a, 20, 80);

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(15, 12, 15);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI / 2.1;

    this.setupLighting();
    this.setupGrid();
    this.setupAxes();
    this.createBarGeometry();

    window.addEventListener('resize', () => this.onResize());
    
    this.animate();
  }

  setupLighting() {
    const ambientLight = new THREE.AmbientLight(0x404080, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    this.scene.add(directionalLight);

    const pointLight1 = new THREE.PointLight(0x10b981, 1, 30);
    pointLight1.position.set(-10, 5, -5);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xef4444, 1, 30);
    pointLight2.position.set(10, 5, 5);
    this.scene.add(pointLight2);

    const pointLight3 = new THREE.PointLight(0x7c3aed, 0.5, 50);
    pointLight3.position.set(0, 15, 0);
    this.scene.add(pointLight3);
  }

  setupGrid() {
    this.gridHelper = new THREE.GridHelper(30, 30, 0x333355, 0x222244);
    this.gridHelper.position.y = 0;
    this.scene.add(this.gridHelper);

    const planeGeometry = new THREE.PlaneGeometry(30, 30);
    const planeMaterial = new THREE.MeshStandardMaterial({
      color: 0x0f0f1e,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.01;
    plane.receiveShadow = true;
    this.scene.add(plane);
  }

  setupAxes() {
    this.axesHelper = new THREE.AxesHelper(12);
    this.axesHelper.setColors(0xff6b6b, 0x51cf66, 0x4dabf7);
    this.scene.add(this.axesHelper);
  }

  createBarGeometry() {
    this.barGeometry = new THREE.BoxGeometry(0.8, 1, 0.8);
    this.barMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.3,
      roughness: 0.4
    });
  }

  createBar(x, y, z, height, color, isAnomaly = false, severity = '') {
    const geometry = new THREE.BoxGeometry(0.8, height, 0.8);
    const material = this.barMaterial.clone();
    material.color.copy(color);

    if (isAnomaly) {
      material.emissive = color.clone();
      material.emissiveIntensity = 0.3;
      material.metalness = 0.5;
      material.roughness = 0.2;
    }

    const bar = new THREE.Mesh(geometry, material);
    bar.position.set(x, height / 2, z);
    bar.castShadow = true;
    bar.receiveShadow = true;
    bar.userData = { isAnomaly, severity };

    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: isAnomaly ? 0xffffff : 0x666666,
      transparent: true,
      opacity: isAnomaly ? 1 : 0.3
    });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    wireframe.position.copy(bar.position);
    bar.add(wireframe);

    return bar;
  }

  updateOrderbook(orderbook) {
    this.currentOrderbook = orderbook;
    this.renderOrderbook();
  }

  renderOrderbook() {
    if (!this.currentOrderbook) return;

    const { bids, asks, midPrice } = this.currentOrderbook;

    this.clearBars();

    if (!midPrice || bids.length === 0 || asks.length === 0) return;

    const allQuantities = [
      ...bids.map(b => b[1]),
      ...asks.map(a => a[1])
    ];
    this.maxQuantity = Math.max(...allQuantities, 0.1);

    const anomalyPriceMap = new Map();
    for (const anomaly of this.currentAnomalies) {
      anomalyPriceMap.set(`${anomaly.side}_${anomaly.price}`, anomaly);
    }

    const bidZ = -3;
    const askZ = 3;

    bids.forEach((bid, i) => {
      const [price, qty] = bid;
      const x = this.priceToX(price, midPrice);
      const height = this.qtyToHeight(qty);
      const key = `bid_${price}`;
      const anomaly = anomalyPriceMap.get(key);

      let color = this.colors.bid;
      let isAnomaly = false;
      let severity = '';

      if (this.showAnomalies && anomaly) {
        isAnomaly = true;
        severity = anomaly.severity;
        color = severity === 'critical' ? this.colors.anomalyCritical : this.colors.anomalyWarning;
      }

      const bar = this.createBar(x, 0, bidZ, height, color, isAnomaly, severity);
      this.bidBars.push(bar);
      this.scene.add(bar);
    });

    asks.forEach((ask, i) => {
      const [price, qty] = ask;
      const x = this.priceToX(price, midPrice);
      const height = this.qtyToHeight(qty);
      const key = `ask_${price}`;
      const anomaly = anomalyPriceMap.get(key);

      let color = this.colors.ask;
      let isAnomaly = false;
      let severity = '';

      if (this.showAnomalies && anomaly) {
        isAnomaly = true;
        severity = anomaly.severity;
        color = severity === 'critical' ? this.colors.anomalyCritical : this.colors.anomalyWarning;
      }

      const bar = this.createBar(x, 0, askZ, height, color, isAnomaly, severity);
      this.askBars.push(bar);
      this.scene.add(bar);
    });
  }

  priceToX(price, midPrice) {
    const normalized = (price - midPrice) / this.priceRange;
    return normalized * 12;
  }

  qtyToHeight(qty) {
    const normalized = Math.min(qty / this.maxQuantity, 1);
    return Math.max(normalized * 10, 0.05);
  }

  clearBars() {
    for (const bar of this.bidBars) {
      this.scene.remove(bar);
      bar.geometry.dispose();
      bar.material.dispose();
    }
    for (const bar of this.askBars) {
      this.scene.remove(bar);
      bar.geometry.dispose();
      bar.material.dispose();
    }
    this.bidBars = [];
    this.askBars = [];
  }

  updateAnomalies(anomalies) {
    this.currentAnomalies = anomalies;
    if (this.showAnomalies && this.currentOrderbook) {
      this.renderOrderbook();
    }
  }

  setShowAnomalies(show) {
    this.showAnomalies = show;
    if (this.currentOrderbook) {
      this.renderOrderbook();
    }
  }

  setShowAxes(show) {
    this.showAxes = show;
    if (this.axesHelper) {
      this.axesHelper.visible = show;
    }
    if (this.gridHelper) {
      this.gridHelper.visible = show;
    }
  }

  setAutoRotate(rotate) {
    this.autoRotate = rotate;
    if (this.controls) {
      this.controls.autoRotate = rotate;
      this.controls.autoRotateSpeed = 1;
    }
  }

  resetCamera() {
    this.camera.position.set(15, 12, 15);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  onResize() {
    const container = this.canvas.parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const time = Date.now() * 0.001;
    
    for (const bar of [...this.bidBars, ...this.askBars]) {
      if (bar.userData.isAnomaly) {
        const pulse = 1 + Math.sin(time * 4) * 0.1;
        bar.material.emissiveIntensity = 0.2 + Math.sin(time * 4) * 0.15;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clearBars();
    this.renderer.dispose();
  }
}

export default OrderbookVisualizer;
