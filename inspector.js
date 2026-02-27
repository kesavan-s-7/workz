/**
 * Inspector — Inspection state machine, statistics tracking
 */
class Inspector {
    constructor() {
        this.state = 'idle'; // idle | inspecting | complete
        this.currentInspection = null;
        this.predictions = []; // Buffer for stability
        this.stats = { total: 0, ok: 0, defective: 0, defectRate: '0.0', categories: {} };
        this._predictionBuffer = [];
        this._bufferSize = 8; // Average over 8 frames
        this._minConfidence = 0.4;
    }

    async init() {
        // Restore stats from storage
        this.stats = await window.storageManager.getInspectionStats();
    }

    /**
     * Called each frame with data from the detector and camera
     */
    processFrame(prediction, presenceInfo) {
        const result = {
            stateChanged: false,
            inspectionComplete: false,
            currentResult: null
        };

        // Product just entered frame
        if (presenceInfo.justEntered) {
            this.state = 'inspecting';
            this.currentInspection = {
                startTime: Date.now(),
                predictions: [],
                thumbnail: null
            };
            this._predictionBuffer = [];
            result.stateChanged = true;
        }

        // During inspection: accumulate predictions
        if (this.state === 'inspecting' && prediction) {
            this._predictionBuffer.push(prediction);

            // Keep only last N predictions
            if (this._predictionBuffer.length > this._bufferSize) {
                this._predictionBuffer.shift();
            }

            result.currentResult = this._getAggregatedResult();
        }

        // Product just left frame → finalize
        if (presenceInfo.justLeft && this.state === 'inspecting') {
            result.inspectionComplete = true;
            result.finalResult = this._getAggregatedResult();
            this.state = 'idle';
            this.currentInspection = null;
            this._predictionBuffer = [];
            result.stateChanged = true;
        }

        return result;
    }

    /**
     * Aggregate buffered predictions for stability
     */
    _getAggregatedResult() {
        if (this._predictionBuffer.length === 0) return null;

        // Count label votes
        const votes = {};
        const confidenceSums = {};
        for (const p of this._predictionBuffer) {
            votes[p.label] = (votes[p.label] || 0) + 1;
            confidenceSums[p.label] = (confidenceSums[p.label] || 0) + p.confidence;
        }

        // Find the label with most votes
        let bestLabel = 'ok';
        let bestVotes = 0;
        for (const [label, count] of Object.entries(votes)) {
            if (count > bestVotes) {
                bestVotes = count;
                bestLabel = label;
            }
        }

        const avgConfidence = confidenceSums[bestLabel] / votes[bestLabel];

        return {
            label: bestLabel,
            confidence: avgConfidence,
            isDefective: bestLabel !== 'ok',
            defectType: bestLabel !== 'ok' ? bestLabel : null,
            status: bestLabel === 'ok' ? 'ok' : 'defective'
        };
    }

    /**
     * Save completed inspection to storage
     */
    async saveInspection(result, thumbnail) {
        const record = {
            timestamp: Date.now(),
            status: result.status,
            defectType: result.defectType,
            confidence: result.confidence,
            duration: this.currentInspection ? Date.now() - this.currentInspection.startTime : 0,
            thumbnail: thumbnail
        };

        await window.storageManager.addInspection(record);

        // Update stats
        this.stats.total++;
        if (result.isDefective) {
            this.stats.defective++;
            const cat = result.defectType || 'unknown';
            this.stats.categories[cat] = (this.stats.categories[cat] || 0) + 1;
        } else {
            this.stats.ok++;
        }
        this.stats.defectRate = this.stats.total > 0
            ? ((this.stats.defective / this.stats.total) * 100).toFixed(1)
            : '0.0';

        return record;
    }

    /**
     * Manually finalize current inspection (e.g. user presses button)
     */
    manualInspect(prediction) {
        if (!prediction) return null;
        return {
            label: prediction.label,
            confidence: prediction.confidence,
            isDefective: prediction.label !== 'ok',
            defectType: prediction.label !== 'ok' ? prediction.label : null,
            status: prediction.label === 'ok' ? 'ok' : 'defective'
        };
    }

    async resetStats() {
        this.stats = { total: 0, ok: 0, defective: 0, defectRate: '0.0', categories: {} };
        await window.storageManager.clearInspections();
    }
}

window.inspector = new Inspector();
