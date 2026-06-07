class TimelinePlayer {
  constructor() {
    this.snapshots = [];
    this.isPlaying = false;
    this.isLive = true;
    this.currentIndex = 0;
    this.playbackSpeed = 1;
    this.playInterval = null;
    this.onSnapshotCallback = null;
    this.onTimeUpdateCallback = null;
    this.onModeChangeCallback = null;
  }

  async loadSnapshots(count = 300) {
    try {
      const response = await fetch(`/api/snapshots?count=${count}`);
      this.snapshots = await response.json();
      this.currentIndex = this.snapshots.length - 1;
      return this.snapshots;
    } catch (err) {
      console.error('[Timeline] Error loading snapshots:', err);
      return [];
    }
  }

  async loadTimeRange(startTime, endTime) {
    try {
      const response = await fetch(`/api/snapshots/range?start=${startTime}&end=${endTime}`);
      this.snapshots = await response.json();
      this.currentIndex = this.snapshots.length - 1;
      return this.snapshots;
    } catch (err) {
      console.error('[Timeline] Error loading time range:', err);
      return [];
    }
  }

  addSnapshot(snapshot) {
    if (this.isLive) {
      this.snapshots.push(snapshot);
      if (this.snapshots.length > 3600) {
        this.snapshots.shift();
      }
      this.currentIndex = this.snapshots.length - 1;
    }
  }

  play() {
    if (this.snapshots.length < 2) return;
    
    this.isPlaying = true;
    this.isLive = false;
    this.notifyModeChange();

    const intervalTime = 1000 / this.playbackSpeed;
    
    this.playInterval = setInterval(() => {
      this.currentIndex++;
      
      if (this.currentIndex >= this.snapshots.length - 1) {
        this.currentIndex = this.snapshots.length - 1;
        this.pause();
        this.goLive();
        return;
      }

      this.playCurrent();
    }, intervalTime);
  }

  pause() {
    this.isPlaying = false;
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
    this.notifyModeChange();
  }

  goLive() {
    this.pause();
    this.isLive = true;
    this.currentIndex = this.snapshots.length - 1;
    this.notifyModeChange();
    
    if (this.snapshots.length > 0) {
      this.playCurrent();
    }
  }

  seekTo(index) {
    this.pause();
    this.isLive = false;
    this.currentIndex = Math.max(0, Math.min(index, this.snapshots.length - 1));
    this.playCurrent();
    this.notifyModeChange();
  }

  setSpeed(speed) {
    this.playbackSpeed = speed;
    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  playCurrent() {
    const snapshot = this.snapshots[this.currentIndex];
    if (snapshot && this.onSnapshotCallback) {
      this.onSnapshotCallback(snapshot);
    }
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback({
        currentIndex: this.currentIndex,
        total: this.snapshots.length,
        timestamp: snapshot?.timestamp || Date.now(),
        startTime: this.snapshots[0]?.timestamp || Date.now(),
        endTime: this.snapshots[this.snapshots.length - 1]?.timestamp || Date.now()
      });
    }
  }

  onSnapshot(callback) {
    this.onSnapshotCallback = callback;
  }

  onTimeUpdate(callback) {
    this.onTimeUpdateCallback = callback;
  }

  onModeChange(callback) {
    this.onModeChangeCallback = callback;
  }

  notifyModeChange() {
    if (this.onModeChangeCallback) {
      this.onModeChangeCallback({
        isPlaying: this.isPlaying,
        isLive: this.isLive,
        currentIndex: this.currentIndex,
        total: this.snapshots.length
      });
    }
  }

  getCurrentSnapshot() {
    return this.snapshots[this.currentIndex] || null;
  }

  getSnapshots() {
    return this.snapshots;
  }

  dispose() {
    this.pause();
    this.snapshots = [];
  }
}

export default TimelinePlayer;
