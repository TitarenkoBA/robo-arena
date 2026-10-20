import { Component, ElementRef, OnDestroy, output, signal, viewChild } from '@angular/core';
import jsQR from 'jsqr';

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/** Сканер QR-кодов с камеры: нативный BarcodeDetector, иначе jsQR. */
@Component({
  selector: 'app-qr-scanner',
  template: `
    <div class="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-black">
      <video #video class="h-full w-full object-cover" playsinline muted></video>
      @if (running()) {
        <div class="pointer-events-none absolute inset-8 rounded-xl border-4 border-emerald-300/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]"></div>
      } @else {
        <button type="button" class="btn btn-primary absolute inset-0 m-auto h-14 w-56" (click)="start()">📷 Включить камеру</button>
      }
    </div>
    @if (error()) {
      <p class="mt-2 text-center text-sm text-orange-300">{{ error() }}</p>
    }
    <canvas #canvas class="hidden"></canvas>
  `,
})
export class QrScannerComponent implements OnDestroy {
  readonly scanned = output<string>();
  protected readonly running = signal(false);
  protected readonly error = signal('');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private stream?: MediaStream;
  private timer = 0;
  private detector?: DetectorLike;
  private busy = false;

  async start() {
    this.error.set('');
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('Камера недоступна. Нужен HTTPS или localhost.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch {
      this.error.set('Нет доступа к камере. Разрешите его в настройках браузера или введите код вручную.');
      return;
    }
    const v = this.video().nativeElement;
    v.srcObject = this.stream;
    await v.play().catch(() => undefined);
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => DetectorLike }).BarcodeDetector;
    if (BD) {
      try {
        this.detector = new BD({ formats: ['qr_code'] });
      } catch {
        this.detector = undefined;
      }
    }
    this.running.set(true);
    this.timer = window.setInterval(() => void this.scan(), 200);
  }

  private async scan() {
    if (this.busy) return;
    const v = this.video().nativeElement;
    if (v.readyState < 2 || !v.videoWidth) return;
    this.busy = true;
    try {
      if (this.detector) {
        const codes = await this.detector.detect(v);
        if (codes.length) return this.found(codes[0].rawValue);
      } else {
        const c = this.canvas().nativeElement;
        const w = Math.min(640, v.videoWidth);
        const h = Math.round((v.videoHeight / v.videoWidth) * w);
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(v, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (res?.data) return this.found(res.data);
      }
    } catch {
      /* кадр не распознан */
    } finally {
      this.busy = false;
    }
  }

  private found(text: string) {
    this.stop();
    navigator.vibrate?.(60);
    this.scanned.emit(text);
  }

  stop() {
    window.clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.running.set(false);
  }

  ngOnDestroy() {
    this.stop();
  }
}
