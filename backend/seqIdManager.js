class SeqIdManager {
  constructor() {
    this.lastProcessedSeqIds = new Map();
    this.pendingSnapshots = new Map();
    this.isReady = new Map();
  }

  init(exchange) {
    const currentIsReady = this.isReady.get(exchange);
    const currentSeqId = this.lastProcessedSeqIds.get(exchange);
    
    if (currentIsReady && currentSeqId > 0) {
      console.log(`[SeqId] ${exchange} already initialized with seqId ${currentSeqId}, skipping reset`);
      return;
    }
    
    this.lastProcessedSeqIds.set(exchange, -1);
    this.pendingSnapshots.set(exchange, null);
    this.isReady.set(exchange, false);
    console.log(`[SeqId] Initialized for ${exchange}`);
  }

  generate(exchange, seqId) {
    this.lastProcessedSeqIds.set(exchange, seqId);
  }

  validate(exchange, seqId) {
    const lastSeqId = this.lastProcessedSeqIds.get(exchange);
    
    if (lastSeqId === undefined) {
      console.warn(`[SeqId] Exchange ${exchange} not initialized`);
      return false;
    }

    if (!this.isReady.get(exchange)) {
      console.warn(`[SeqId] Exchange ${exchange} not ready, waiting for snapshot`);
      return false;
    }

    if (seqId <= lastSeqId) {
      console.log(`[SeqId] Stale message for ${exchange}: ${seqId} <= ${lastSeqId}, skipping`);
      return false;
    }

    return true;
  }

  setSnapshot(exchange, snapshot) {
    this.pendingSnapshots.set(exchange, snapshot);
    this.lastProcessedSeqIds.set(exchange, snapshot.lastUpdateId);
    this.isReady.set(exchange, true);
    console.log(`[SeqId] Snapshot applied for ${exchange}, seqId: ${snapshot.lastUpdateId}`);
  }

  isExchangeReady(exchange) {
    return this.isReady.get(exchange) || false;
  }

  setReady(exchange, ready = true) {
    this.isReady.set(exchange, ready);
  }

  reset(exchange) {
    if (exchange) {
      this.lastProcessedSeqIds.set(exchange, -1);
      this.pendingSnapshots.set(exchange, null);
      this.isReady.set(exchange, false);
      console.log(`[SeqId] Reset for ${exchange}`);
    } else {
      for (const key of this.lastProcessedSeqIds.keys()) {
        this.reset(key);
      }
    }
  }

  getLastSeqId(exchange) {
    return this.lastProcessedSeqIds.get(exchange) || -1;
  }

  getPendingSnapshot(exchange) {
    return this.pendingSnapshots.get(exchange);
  }

  getAllStatus() {
    const status = {};
    for (const exchange of this.lastProcessedSeqIds.keys()) {
      status[exchange] = {
        lastSeqId: this.lastProcessedSeqIds.get(exchange),
        isReady: this.isReady.get(exchange),
        hasSnapshot: this.pendingSnapshots.get(exchange) !== null
      };
    }
    return status;
  }
}

module.exports = new SeqIdManager();
