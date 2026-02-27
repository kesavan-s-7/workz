/**
 * CameraManager — Real-time camera access & frame capture
 */
class CameraManager {
    constructor() {
        this.video = document.getElementById('camera-feed');
        this.overlay = document.getElementById('overlay-canvas');
        this.ctx = this.overlay.getContext('2d');
        this.stream = null;
        this.isActive = false;

        // Frame differencing for product detection
        this._prevFrame = null;
        this._motionThreshold = 25;
        this._presenceThreshold = 0.02; // 2% of pixels changed = product present
        this._exitFrameCount = 0;
        this._exitFrameRequired = 15; // ~0.5s at 30fps
        this._productPresent = false;
    }

    async start() {
        try {
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: false
            };
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            await this.video.play();
            this._syncOverlay();
            this.isActive = true;

            // Show live badge
            document.getElementById('video-badge').classList.add('visible');
            document.getElementById('no-camera').classList.add('hidden');

            return true;
        } catch (err) {
            console.error('Camera error:', err);
            return false;
        }
    }

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        this.isActive = false;
        this.video.srcObject = null;
        document.getElementById('video-badge').classList.remove('visible');
    }

    _syncOverlay() {
        const w = this.video.videoWidth || 640;
        const h = this.video.videoHeight || 480;
        this.overlay.width = w;
        this.overlay.height = h;
    }

    /**
     * Capture the current video frame as an offscreen canvas
     */
    captureFrame() {
        if (!this.isActive || this.video.readyState < 2) return null;
        const w = this.video.videoWidth;
        const h = this.video.videoHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0, w, h);
        return canvas;
    }

    /**
     * Capture a thumbnail (small version for history)
     */
    captureThumbnail(size = 96) {
        if (!this.isActive) return null;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;
        const side = Math.min(vw, vh);
        const sx = (vw - side) / 2;
        const sy = (vh - side) / 2;
        ctx.drawImage(this.video, sx, sy, side, side, 0, 0, size, size);
        return canvas.toDataURL('image/jpeg', 0.6);
    }

    /**
     * Detect product presence via frame differencing
     * Returns: { present: bool, justEntered: bool, justLeft: bool }
     */
    detectProductPresence() {
        if (!this.isActive || this.video.readyState < 2) {
            return { present: false, justEntered: false, justLeft: false };
        }

        const w = 160; // Small size for performance
        const h = 120;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0, w, h);
        const currentFrame = ctx.getImageData(0, 0, w, h);

        const result = { present: false, justEntered: false, justLeft: false };

        if (this._prevFrame) {
            let changedPixels = 0;
            const totalPixels = w * h;
            const curr = currentFrame.data;
            const prev = this._prevFrame.data;

            for (let i = 0; i < curr.length; i += 16) { // Sample every 4th pixel
                const dr = Math.abs(curr[i] - prev[i]);
                const dg = Math.abs(curr[i + 1] - prev[i + 1]);
                const db = Math.abs(curr[i + 2] - prev[i + 2]);
                if ((dr + dg + db) / 3 > this._motionThreshold) {
                    changedPixels++;
                }
            }

            const motionRatio = changedPixels / (totalPixels / 4);
            const hasMotion = motionRatio > this._presenceThreshold;

            if (hasMotion) {
                this._exitFrameCount = 0;
                if (!this._productPresent) {
                    this._productPresent = true;
                    result.justEntered = true;
                }
                result.present = true;
            } else {
                if (this._productPresent) {
                    this._exitFrameCount++;
                    if (this._exitFrameCount >= this._exitFrameRequired) {
                        this._productPresent = false;
                        result.justLeft = true;
                    } else {
                        result.present = true; // Still counting
                    }
                }
            }
        }

        this._prevFrame = currentFrame;
        return result;
    }

    /**
     * Draw overlay annotations on the video feed
     */
    drawOverlay(status, defectType, confidence) {
        this._syncOverlay();
        const w = this.overlay.width;
        const h = this.overlay.height;
        this.ctx.clearRect(0, 0, w, h);

        if (!status || status === 'idle') return;

        const color = status === 'ok' ? '#22c55e' : '#ef4444';
        const borderWidth = 4;

        // Draw border frame
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = borderWidth;
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 12;
        this.ctx.strokeRect(borderWidth, borderWidth, w - borderWidth * 2, h - borderWidth * 2);
        this.ctx.shadowBlur = 0;

        // Draw corner brackets
        const cornerLen = 40;
        this.ctx.lineWidth = 3;
        const positions = [
            [borderWidth + 8, borderWidth + 8, cornerLen, 0, 0, cornerLen],
            [w - borderWidth - 8, borderWidth + 8, -cornerLen, 0, 0, cornerLen],
            [borderWidth + 8, h - borderWidth - 8, cornerLen, 0, 0, -cornerLen],
            [w - borderWidth - 8, h - borderWidth - 8, -cornerLen, 0, 0, -cornerLen]
        ];
        for (const [x, y, dx, _dy1, _dx2, dy] of positions) {
            this.ctx.beginPath();
            this.ctx.moveTo(x + dx, y);
            this.ctx.lineTo(x, y);
            this.ctx.lineTo(x, y + dy);
            this.ctx.stroke();
        }

        // Label
        if (defectType && status === 'defective') {
            const label = `${defectType.toUpperCase()} (${(confidence * 100).toFixed(0)}%)`;
            this.ctx.font = 'bold 18px Inter, sans-serif';
            const metrics = this.ctx.measureText(label);
            const lx = 20;
            const ly = h - 30;

            this.ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
            this.ctx.beginPath();
            this.ctx.roundRect(lx - 8, ly - 20, metrics.width + 16, 28, 6);
            this.ctx.fill();

            this.ctx.fillStyle = '#fff';
            this.ctx.fillText(label, lx, ly);
        }
    }
}

window.cameraManager = new CameraManager();
