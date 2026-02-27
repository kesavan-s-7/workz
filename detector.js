/**
 * DefectDetector — TensorFlow.js MobileNet + KNN Classifier
 * On-device AI for real-time defect classification
 */
class DefectDetector {
    constructor() {
        this.mobilenet = null;
        this.knn = null;
        this.isReady = false;
        this.isLoading = false;
        this.defaultCategories = ['ok', 'scratch', 'crack', 'wrong_color', 'misalignment'];
        this.categories = [...this.defaultCategories];
        this._intermediateActivation = null;
    }

    /**
     * Initialize: load MobileNet (quantized INT8) and KNN classifier
     */
    async init(onProgress) {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            // Set TF.js backend
            await tf.setBackend('webgl');
            await tf.ready();
            if (onProgress) onProgress(20, 'TensorFlow.js backend ready');

            // Load MobileNet v2 (quantized for INT8 optimization)
            if (onProgress) onProgress(30, 'Loading MobileNet model...');
            this.mobilenet = await mobilenet.load({
                version: 2,
                alpha: 0.5, // Smaller model for mobile performance
            });
            if (onProgress) onProgress(70, 'MobileNet loaded');

            // Create KNN classifier
            this.knn = knnClassifier.create();
            if (onProgress) onProgress(80, 'KNN classifier created');

            // Try to restore saved KNN data
            await this._restoreKNN();
            if (onProgress) onProgress(90, 'Model data restored');

            // Load custom categories
            const savedCats = await window.storageManager.getSetting('categories');
            if (savedCats) {
                this.categories = savedCats;
            }

            this.isReady = true;
            this.isLoading = false;
            if (onProgress) onProgress(100, 'System ready');
        } catch (err) {
            console.error('Detector init error:', err);
            this.isLoading = false;
            throw err;
        }
    }

    /**
     * Get MobileNet activation (feature embedding) for an image element
     */
    _getActivation(imageElement) {
        // Use MobileNet's infer method to get the intermediate activation
        // This returns a 1D feature tensor suitable for KNN
        return this.mobilenet.infer(imageElement, true); // true = get embedding
    }

    /**
     * Add a training example
     * @param {HTMLImageElement|HTMLCanvasElement|HTMLVideoElement} imageElement
     * @param {string} label - category label
     */
    addExample(imageElement, label) {
        if (!this.isReady) throw new Error('Detector not ready');
        const activation = this._getActivation(imageElement);
        this.knn.addExample(activation, label);
        // Don't dispose activation — KNN stores reference
    }

    /**
     * Predict the class of an image
     * @param {HTMLImageElement|HTMLCanvasElement|HTMLVideoElement} imageElement
     * @returns {{ label: string, confidences: Object, isDefective: boolean }}
     */
    async predict(imageElement) {
        if (!this.isReady) return null;
        if (this.knn.getNumClasses() === 0) return null;

        const activation = this._getActivation(imageElement);
        try {
            const result = await this.knn.predictClass(activation, 10); // k=10
            activation.dispose();

            const confidences = {};
            for (const [cls, conf] of Object.entries(result.confidences)) {
                confidences[cls] = conf;
            }

            return {
                label: result.label,
                confidences: confidences,
                confidence: result.confidences[result.label],
                isDefective: result.label !== 'ok'
            };
        } catch (err) {
            activation.dispose();
            console.error('Prediction error:', err);
            return null;
        }
    }

    /**
     * Get example counts per class
     */
    getExampleCounts() {
        if (!this.knn) return {};
        return this.knn.getClassExampleCount();
    }

    /**
     * Get total number of training examples
     */
    getTotalExamples() {
        const counts = this.getExampleCounts();
        return Object.values(counts).reduce((a, b) => a + b, 0);
    }

    /**
     * Check if the model has enough examples to make predictions
     */
    isTrainingReady() {
        const counts = this.getExampleCounts();
        const classes = Object.keys(counts);
        // Need at least 2 classes with at least 1 example each
        return classes.length >= 2 && classes.every(c => counts[c] >= 1);
    }

    /**
     * Add a new category
     */
    addCategory(name) {
        const key = name.toLowerCase().replace(/\s+/g, '_');
        if (!this.categories.includes(key)) {
            this.categories.push(key);
            window.storageManager.saveSetting('categories', this.categories);
        }
        return key;
    }

    /**
     * Remove a category
     */
    removeCategory(name) {
        this.categories = this.categories.filter(c => c !== name);
        window.storageManager.saveSetting('categories', this.categories);
    }

    /**
     * Save KNN model to IndexedDB
     */
    async saveKNN() {
        if (!this.knn || this.knn.getNumClasses() === 0) return;

        const dataset = this.knn.getClassifierDataset();
        const dataToSave = {};

        for (const [label, tensor] of Object.entries(dataset)) {
            dataToSave[label] = {
                data: Array.from(tensor.dataSync()),
                shape: tensor.shape
            };
        }

        await window.storageManager.saveKNNData(dataToSave);
        await window.storageManager.saveSetting('categories', this.categories);
    }

    /**
     * Restore KNN model from IndexedDB
     */
    async _restoreKNN() {
        try {
            const savedData = await window.storageManager.loadKNNData();
            if (!savedData) return;

            for (const [label, tensorData] of Object.entries(savedData)) {
                const tensor = tf.tensor(tensorData.data, tensorData.shape);
                this.knn.setClassifierDataset(
                    Object.fromEntries(
                        Object.entries(savedData).map(([l, d]) =>
                            [l, tf.tensor(d.data, d.shape)]
                        )
                    )
                );
                break; // setClassifierDataset sets all at once
            }
        } catch (err) {
            console.warn('Could not restore KNN data:', err);
        }
    }

    /**
     * Clear all training data
     */
    async clearAll() {
        if (this.knn) {
            this.knn.clearAllClasses();
        }
        await window.storageManager.clearKNNData();
    }

    /**
     * Dispose of tensors and clean up
     */
    dispose() {
        if (this.knn) this.knn.dispose();
        if (this.mobilenet) {
            // MobileNet doesn't have a standard dispose
        }
    }
}

window.defectDetector = new DefectDetector();
