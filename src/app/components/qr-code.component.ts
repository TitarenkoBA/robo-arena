import { Component, effect, input, signal } from '@angular/core';
import QRCode from 'qrcode';

@Component({
  selector: 'app-qr-code',
  template: `
    @if (src()) {
      <img [src]="src()" [alt]="'QR: ' + text()" class="block rounded-xl bg-white p-2" [style.width.px]="size()" [style.height.px]="size()" />
    } @else {
      <div class="grid place-items-center rounded-xl bg-white/10 text-sm text-white/60" [style.width.px]="size()" [style.height.px]="size()">QR…</div>
    }
  `,
})
export class QrCodeComponent {
  readonly text = input.required<string>();
  readonly size = input(200);
  protected readonly src = signal<string | null>(null);

  constructor() {
    effect(() => {
      const t = this.text();
      QRCode.toDataURL(t, { margin: 1, width: 512, errorCorrectionLevel: 'M', color: { dark: '#141a2e', light: '#ffffff' } })
        .then((url) => this.src.set(url))
        .catch(() => this.src.set(null));
    });
  }
}
