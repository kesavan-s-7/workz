/**
 * TrainingManager — UI handlers for adding training examples
 */
class TrainingManager {
    constructor() {
        this.categorySelect = document.getElementById('training-category');
        this.captureBtn = document.getElementById('btn-capture-example');
        this.fileInput = document.getElementById('file-upload-examples');
        this.countGrid = document.getElementById('example-count-grid');
        this.statusEl = document.getElementById('training-status');
        this.statusText = document.getElementById('training-status-text');
        this.addCatBtn = document.getElementById('btn-add-category');
        this.newCatInput = document.getElementById('new-category-name');
        this.clearBtn = document.getElementById('btn-clear-training');
        this.saveBtn = document.getElementById('btn-save-model');
    }

    init() {
        // Capture frame as training example
        this.captureBtn.addEventListener('click', () => this._captureExample());

        // Upload images as training examples
        this.fileInput.addEventListener('change', (e) => this._uploadExamples(e));

        // Add custom category
        this.addCatBtn.addEventListener('click', () => this._addCategory());
        this.newCatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._addCategory();
        });

        // Clear all training data
        this.clearBtn.addEventListener('click', async () => {
            if (confirm('Clear all training data? This cannot be undone.')) {
                await window.defectDetector.clearAll();
                this.updateCounts();
            }
        });

        // Save model
        this.saveBtn.addEventListener('click', async () => {
            await window.defectDetector.saveKNN();
            this._showToast('Model saved successfully');
        });

        // Initial render
        this.updateCategoryOptions();
        this.updateCounts();
    }

    /**
     * Capture current camera frame as a training example
     */
    _captureExample() {
        const label = this.categorySelect.value;
        const frame = window.cameraManager.captureFrame();
        if (!frame) {
            this._showToast('No camera frame available');
            return;
        }

        try {
            window.defectDetector.addExample(frame, label);
            this.updateCounts();
            this._flashButton(this.captureBtn);
            this._showToast(`Added example for "${this._formatLabel(label)}"`);
        } catch (err) {
            console.error('Error adding example:', err);
            this._showToast('Error adding example');
        }
    }

    /**
     * Upload image files as training examples
     */
    async _uploadExamples(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const label = this.categorySelect.value;
        let added = 0;

        for (const file of files) {
            try {
                const img = await this._loadImage(file);
                window.defectDetector.addExample(img, label);
                added++;
            } catch (err) {
                console.warn('Failed to load image:', file.name, err);
            }
        }

        this.updateCounts();
        this._showToast(`Added ${added} example(s) for "${this._formatLabel(label)}"`);
        this.fileInput.value = ''; // Reset
    }

    /**
     * Load a File as an HTMLImageElement
     */
    _loadImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    /**
     * Add a new custom category
     */
    _addCategory() {
        const name = this.newCatInput.value.trim();
        if (!name) return;

        const key = window.defectDetector.addCategory(name);
        this.updateCategoryOptions();
        this.updateCounts();
        this.newCatInput.value = '';
        this._showToast(`Added category "${name}"`);

        // Also update defect breakdown in main UI
        this._updateBreakdownUI();
    }

    /**
     * Update the category dropdown options
     */
    updateCategoryOptions() {
        const categories = window.defectDetector.categories;
        const currentVal = this.categorySelect.value;

        this.categorySelect.innerHTML = '';

        const icons = {
            ok: '✅', scratch: '🔸', crack: '🔴',
            wrong_color: '🟣', misalignment: '🟠'
        };

        for (const cat of categories) {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = `${icons[cat] || '🔷'} ${this._formatLabel(cat)}`;
            this.categorySelect.appendChild(opt);
        }

        if (categories.includes(currentVal)) {
            this.categorySelect.value = currentVal;
        }
    }

    /**
     * Update example counts display
     */
    updateCounts() {
        const counts = window.defectDetector.getExampleCounts();
        const categories = window.defectDetector.categories;

        this.countGrid.innerHTML = '';

        for (const cat of categories) {
            const count = counts[cat] || 0;
            const item = document.createElement('div');
            item.className = 'count-item';
            item.innerHTML = `
                <span class="ci-label">${this._formatLabel(cat)}</span>
                <span class="ci-value">${count}</span>
            `;
            this.countGrid.appendChild(item);
        }

        // Update training status
        const ready = window.defectDetector.isTrainingReady();
        if (ready) {
            this.statusEl.classList.add('ready');
            this.statusText.textContent = 'Model ready for detection';
        } else {
            this.statusEl.classList.remove('ready');
            const total = window.defectDetector.getTotalExamples();
            if (total === 0) {
                this.statusText.textContent = 'Add examples to enable detection';
            } else {
                this.statusText.textContent = 'Need examples in at least 2 categories';
            }
        }
    }

    /**
     * Update the defect breakdown cards in the main UI for custom categories
     */
    _updateBreakdownUI() {
        const container = document.getElementById('category-breakdown');
        const categories = window.defectDetector.categories.filter(c => c !== 'ok');
        const colors = {
            scratch: 'var(--clr-scratch)',
            crack: 'var(--clr-crack)',
            wrong_color: 'var(--clr-wrong-color)',
            misalignment: 'var(--clr-misalignment)'
        };

        container.innerHTML = '';
        for (const cat of categories) {
            const row = document.createElement('div');
            row.className = 'category-row';
            row.innerHTML = `
                <span class="cat-color" style="background:${colors[cat] || 'var(--accent)'}"></span>
                <span class="cat-name">${this._formatLabel(cat)}</span>
                <span class="cat-count" id="cat-${cat}">0</span>
            `;
            container.appendChild(row);
        }
    }

    /**
     * Format a label key to display text
     */
    _formatLabel(label) {
        return label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    /**
     * Flash a button to indicate success
     */
    _flashButton(btn) {
        btn.style.transform = 'scale(0.95)';
        setTimeout(() => { btn.style.transform = ''; }, 150);
    }

    /**
     * Show a toast notification
     */
    _showToast(message) {
        // Create toast element
        let toast = document.querySelector('.toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.style.cssText = `
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(100%);
                padding: 12px 24px; background: rgba(99, 102, 241, 0.9); color: #fff;
                border-radius: 8px; font-size: 0.85rem; font-weight: 500; z-index: 1000;
                transition: transform 0.3s ease; backdrop-filter: blur(8px);
                box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            `;
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.style.transform = 'translateX(-50%) translateY(0)';

        clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            toast.style.transform = 'translateX(-50%) translateY(100%)';
        }, 2500);
    }
}

window.trainingManager = new TrainingManager();
