import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.maxParticles = 200;
    this.pool = [];
    this.initPool();
  }

  initPool() {
    for (let i = 0; i < this.maxParticles; i++) {
      const geometry = new THREE.SphereGeometry(0.1, 8, 8);
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 1
      });
      const particle = new THREE.Mesh(geometry, material);
      particle.visible = false;
      particle.userData = {
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0
      };
      this.pool.push(particle);
      this.scene.add(particle);
    }
  }

  emit(position, color, count = 30) {
    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
      const particle = this.pool.find(p => !p.visible);
      if (!particle) break;

      particle.position.copy(position);
      particle.material.color.copy(color);
      particle.material.opacity = 1;
      particle.visible = true;
      particle.scale.setScalar(0.5 + Math.random() * 1);

      const speed = 0.1 + Math.random() * 0.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      particle.userData.velocity.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.abs(Math.cos(phi)) * speed + 0.1,
        Math.sin(phi) * Math.sin(theta) * speed
      );
      particle.userData.life = 2 + Math.random() * 2;
      particle.userData.maxLife = particle.userData.life;

      this.particles.push(particle);
    }
  }

  update(deltaTime) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      if (!particle.visible) {
        this.particles.splice(i, 1);
        continue;
      }

      particle.userData.life -= deltaTime;
      if (particle.userData.life <= 0) {
        particle.visible = false;
        this.particles.splice(i, 1);
        continue;
      }

      particle.position.add(particle.userData.velocity);
      particle.userData.velocity.y -= 0.005;
      particle.material.opacity = particle.userData.life / particle.userData.maxLife;
      particle.scale.setScalar(0.5 + (1 - particle.userData.life / particle.userData.maxLife) * 0.5);
    }
  }

  dispose() {
    for (const particle of this.pool) {
      particle.geometry.dispose();
      particle.material.dispose();
      this.scene.remove(particle);
    }
    this.particles = [];
    this.pool = [];
  }
}

class OrderbookVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.bidBars = [];
    this.askBars = [];
    this.predictedBidBars = [];
    this.predictedAskBars = [];
    this.anomalyMarkers = [];
    this.gridHelper = null;
    this.axesHelper = null;
    this.particleSystem = null;
    this.showAnomalies = true;
    this.showAxes = true;
    this.showPrediction = true;
    this.autoRotate = false;
    this.currentOrderbook = null;
    this.currentPrediction = null;
    this.currentAnomalies = [];
    this.priceRange = 50;
    this.maxQuantity = 1;
    this.isVRMode = false;
    this.vrCamera = null;
    this.controller1 = null;
    this.controller2 = null;
    this.dolly = null;
    this.lastTime = 0;
    
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
    this.setupParticles();
    this.setupVR();

    window.addEventListener('resize', () => this.onResize());
    
    this.lastTime = performance.now();
    this.animate();
  }

  setupParticles() {
    this.particleSystem = new ParticleSystem(this.scene);
  }

  setupVR() {
    this.dolly = new THREE.Group();
    this.dolly.position.set(15, 12, 15);
    this.scene.add(this.dolly);

    this.vrCamera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
    this.dolly.add(this.vrCamera);

    this.renderer.xr.enabled = true;

    if ('xr' in navigator) {
      navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        if (supported) {
          const vrButton = VRButton.createButton(this.renderer);
          vrButton.id = 'vrButton';
          vrButton.style.position = 'fixed';
          vrButton.style.bottom = '20px';
          vrButton.style.right = '20px';
          document.body.appendChild(vrButton);
        }
      });
    }

    const controllerModelFactory = new XRControllerModelFactory();

    this.controller1 = this.renderer.xr.getController(0);
    this.controller1.addEventListener('selectstart', () => this.onVRSelectStart(0));
    this.controller1.addEventListener('selectend', () => this.onVRSelectEnd(0));
    this.dolly.add(this.controller1);
    this.dolly.add(controllerModelFactory.createControllerModel(this.controller1));

    this.controller2 = this.renderer.xr.getController(1);
    this.controller2.addEventListener('selectstart', () => this.onVRSelectStart(1));
    this.controller2.addEventListener('selectend', () => this.onVRSelectEnd(1));
    this.dolly.add(this.controller2);
    this.dolly.add(controllerModelFactory.createControllerModel(this.controller2));

    const raycaster = new THREE.Raycaster();
    const workingMatrix = new THREE.Matrix4();

    this.renderer.xr.addEventListener('sessionstart', () => {
      this.isVRMode = true;
      this.controls.enabled = false;
      console.log('[VR] Session started');
    });

    this.renderer.xr.addEventListener('sessionend', () => {
      this.isVRMode = false;
      this.controls.enabled = true;
      console.log('[VR] Session ended');
    });
  }

  onVRSelectStart(controllerIndex) {
    console.log(`[VR] Controller ${controllerIndex} select start`);
  }

  onVRSelectEnd(controllerIndex) {
    console.log(`[VR] Controller ${controllerIndex} select end`);
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

  createBar(x, y, z, height, color, isAnomaly = false, severity = '', isPrediction = false) {
    const geometry = new THREE.BoxGeometry(0.8, height, 0.8);
    const material = this.barMaterial.clone();
    material.color.copy(color);

    if (isPrediction) {
      material.transparent = true;
      material.opacity = 0.35;
      material.wireframe = true;
      material.wireframeLinewidth = 2;
    } else if (isAnomaly) {
      material.emissive = color.clone();
      material.emissiveIntensity = 0.3;
      material.metalness = 0.5;
      material.roughness = 0.2;
    }

    const bar = new THREE.Mesh(geometry, material);
    bar.position.set(x, height / 2, z);
    bar.castShadow = !isPrediction;
    bar.receiveShadow = !isPrediction;
    bar.userData = { isAnomaly, severity, isPrediction };

    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: isPrediction ? color : (isAnomaly ? 0xffffff : 0x666666),
      transparent: true,
      opacity: isPrediction ? 0.6 : (isAnomaly ? 1 : 0.3)
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

    if (this.showPrediction && this.currentPrediction) {
      this.renderPrediction();
    }
  }

  renderPrediction() {
    if (!this.currentPrediction || !this.currentOrderbook) return;

    const { bids: predictedBids, asks: predictedAsks, midPrice } = this.currentPrediction;
    if (!midPrice) return;

    this.clearPredictedBars();

    const bidZ = -5;
    const askZ = 5;

    predictedBids.forEach((bid, i) => {
      const [price, qty] = bid;
      const x = this.priceToX(price, midPrice);
      const height = this.qtyToHeight(qty);
      const bar = this.createBar(x, 0, bidZ, height, this.colors.bid, false, '', true);
      this.predictedBidBars.push(bar);
      this.scene.add(bar);
    });

    predictedAsks.forEach((ask, i) => {
      const [price, qty] = ask;
      const x = this.priceToX(price, midPrice);
      const height = this.qtyToHeight(qty);
      const bar = this.createBar(x, 0, askZ, height, this.colors.ask, false, '', true);
      this.predictedAskBars.push(bar);
      this.scene.add(bar);
    });
  }

  updatePrediction(prediction) {
    this.currentPrediction = prediction;
    if (this.showPrediction && this.currentOrderbook) {
      this.renderPrediction();
    }
  }

  triggerLargeOrderParticles(largeOrders) {
    if (!this.currentOrderbook || !this.particleSystem) return;

    const { midPrice } = this.currentOrderbook;
    if (!midPrice) return;

    for (const order of largeOrders) {
      const x = this.priceToX(order.price, midPrice);
      const z = order.side === 'bid' ? -3 : 3;
      const y = this.qtyToHeight(order.quantity) + 1;

      const color = order.severity === 'critical' 
        ? this.colors.anomalyCritical 
        : this.colors.anomalyWarning;

      const position = new THREE.Vector3(x, y, z);
      const particleCount = Math.min(Math.floor(order.quantity * 50) + 20, 80);
      
      this.particleSystem.emit(position, color, particleCount);
    }
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

  clearPredictedBars() {
    for (const bar of this.predictedBidBars) {
      this.scene.remove(bar);
      bar.geometry.dispose();
      bar.material.dispose();
    }
    for (const bar of this.predictedAskBars) {
      this.scene.remove(bar);
      bar.geometry.dispose();
      bar.material.dispose();
    }
    this.predictedBidBars = [];
    this.predictedAskBars = [];
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

  setShowPrediction(show) {
    this.showPrediction = show;
    if (show && this.currentPrediction && this.currentOrderbook) {
      this.renderPrediction();
    } else if (!show) {
      this.clearPredictedBars();
    }
  }

  resetCamera() {
    this.camera.position.set(15, 12, 15);
    if (this.dolly) {
      this.dolly.position.set(15, 12, 15);
      this.dolly.rotation.set(0, 0, 0);
    }
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
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
    this.renderer.setAnimationLoop(() => {
      const currentTime = performance.now();
      const deltaTime = (currentTime - this.lastTime) / 1000;
      this.lastTime = currentTime;

      const time = Date.now() * 0.001;
      
      for (const bar of [...this.bidBars, ...this.askBars]) {
        if (bar.userData.isAnomaly) {
          const pulse = 1 + Math.sin(time * 4) * 0.1;
          bar.material.emissiveIntensity = 0.2 + Math.sin(time * 4) * 0.15;
        }
      }

      if (this.particleSystem) {
        this.particleSystem.update(deltaTime);
      }

      if (!this.isVRMode) {
        this.controls.update();
      }

      const camera = this.isVRMode ? this.vrCamera : this.camera;
      this.renderer.render(this.scene, camera);
    });
  }

  dispose() {
    this.clearBars();
    this.clearPredictedBars();
    if (this.particleSystem) {
      this.particleSystem.dispose();
    }
    if (this.renderer.xr) {
      this.renderer.xr.enabled = false;
    }
    const vrButton = document.getElementById('vrButton');
    if (vrButton) {
      vrButton.remove();
    }
    this.renderer.dispose();
  }
}

export default OrderbookVisualizer;
