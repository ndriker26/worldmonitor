import type { EnergyEvent } from '@/services/energy-events';

export class GevToast {
  private queue: EnergyEvent[] = [];
  private current: HTMLElement | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private onClickCb: ((ev: EnergyEvent) => void) | null = null;

  onToastClick(cb: (ev: EnergyEvent) => void): void {
    this.onClickCb = cb;
  }

  show(ev: EnergyEvent): void {
    if (ev.severity === 'info') return;
    this.queue.push(ev);
    if (!this.current) this.flush();
  }

  private flush(): void {
    const ev = this.queue.shift();
    if (!ev) return;
    this.render(ev);
  }

  private render(ev: EnergyEvent): void {
    if (this.current) { this.current.remove(); this.current = null; }
    if (this.dismissTimer) { clearTimeout(this.dismissTimer); this.dismissTimer = null; }

    const el = document.createElement('div');
    el.className = `gev-toast gev-toast-${ev.severity}`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <span class="gev-toast-icon">${ev.icon}</span>
      <span class="gev-toast-text">${ev.title}</span>
      <button class="gev-toast-close" aria-label="Dismiss">✕</button>
    `;
    document.body.appendChild(el);
    this.current = el;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('gev-toast-in'));
    });

    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('gev-toast-close')) {
        this.dismiss();
        return;
      }
      this.onClickCb?.(ev);
      this.dismiss();
    });

    this.dismissTimer = setTimeout(() => this.dismiss(), 5000);
  }

  private dismiss(): void {
    const el = this.current;
    if (!el) return;
    if (this.dismissTimer) { clearTimeout(this.dismissTimer); this.dismissTimer = null; }
    el.classList.remove('gev-toast-in');
    setTimeout(() => {
      if (el.parentNode) el.remove();
      if (this.current === el) this.current = null;
      this.flush();
    }, 320);
  }

  destroy(): void {
    this.current?.remove();
    this.current = null;
    this.queue = [];
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
  }
}
