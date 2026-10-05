// The status picker: a small menu anchored to a task's icon (role="menu" with menuitemradio items).
// Arrow keys, Home/End, Enter and Escape navigate; the status characters (Space + x / - >) pick directly.

import type { StatusKey } from '../rendered/protocol';
import { statusIconSvg, UI_ICONS } from './icons';
import { STATUS_INFO, STATUS_KEYS, STATUS_ORDER, StatusKind } from './structure';

export interface PickerRequest {
    /** Where to anchor the menu (the icon's rectangle) */
    anchor: DOMRect;
    current: StatusKind;
    /** Accessible name of the task, e.g. its text */
    taskName: string;
    onPick(status: StatusKey): void;
    /** Called when the menu closes without a pick */
    onCancel(): void;
}

export class StatusPicker {
    private readonly menu: HTMLElement;
    private readonly items: HTMLElement[] = [];
    private index = 0;
    private request: PickerRequest | undefined;

    constructor(parent: HTMLElement) {
        this.menu = document.createElement('div');
        this.menu.className = 'dbm-picker';
        this.menu.setAttribute('role', 'menu');
        this.menu.hidden = true;
        for (const status of STATUS_ORDER) {
            const info = STATUS_INFO[status];
            const item = document.createElement('div');
            item.className = 'dbm-picker-item';
            item.setAttribute('role', 'menuitemradio');
            item.tabIndex = -1;
            item.dataset.status = status;
            item.innerHTML =
                `<span class="dbm-picker-check">${UI_ICONS.check}</span>` +
                `<span class="dbm-st-${status}">${statusIconSvg(status)}</span>`;
            const label = document.createElement('span');
            label.className = 'dbm-picker-label';
            label.textContent = info.label;
            const hint = document.createElement('kbd');
            hint.textContent = info.hint;
            hint.setAttribute('aria-hidden', 'true');
            item.append(label, hint);
            item.setAttribute('aria-keyshortcuts', info.hint === 'Space' ? 'Space' : info.hint);
            this.items.push(item);
            this.menu.appendChild(item);
        }
        parent.appendChild(this.menu);

        this.menu.addEventListener('mousedown', event => event.preventDefault());
        this.menu.addEventListener('click', event => {
            const item = (event.target as HTMLElement).closest<HTMLElement>('.dbm-picker-item');
            if (item) {
                this.pick(item.dataset.status as StatusKey);
            }
        });
        this.menu.addEventListener('mousemove', event => {
            const item = (event.target as HTMLElement).closest<HTMLElement>('.dbm-picker-item');
            const index = item ? this.items.indexOf(item) : -1;
            if (index >= 0 && index !== this.index) {
                this.focusItem(index);
            }
        });
        this.menu.addEventListener('keydown', event => this.onKey(event));
        document.addEventListener('mousedown', event => {
            if (this.isOpen && !this.menu.contains(event.target as Node)) {
                this.cancel();
            }
        }, true);
        window.addEventListener('resize', () => this.cancel());
        window.addEventListener('blur', () => this.cancel());
    }

    get isOpen(): boolean {
        return !this.menu.hidden;
    }

    open(request: PickerRequest) {
        if (this.request) {
            this.close();
        }
        this.request = request;
        this.menu.setAttribute('aria-label', `Status of ${request.taskName}`);
        for (const item of this.items) {
            item.setAttribute('aria-checked', String(item.dataset.status === request.current));
        }
        this.menu.hidden = false;
        this.position(request.anchor);
        this.focusItem(Math.max(0, STATUS_ORDER.indexOf(request.current as StatusKey)));
    }

    /** Closes without picking */
    cancel() {
        const request = this.request;
        if (request) {
            this.close();
            request.onCancel();
        }
    }

    private close() {
        this.request = undefined;
        this.menu.hidden = true;
    }

    private pick(status: StatusKey) {
        const request = this.request;
        if (request) {
            this.close();
            request.onPick(status);
        }
    }

    private position(anchor: DOMRect) {
        const width = this.menu.offsetWidth, height = this.menu.offsetHeight;
        let left = Math.min(anchor.left - 4, window.innerWidth - width - 8);
        let top = anchor.bottom + 4;
        if (top + height > window.innerHeight - 8) {
            top = anchor.top - height - 4;
        }
        this.menu.style.left = `${Math.max(8, left)}px`;
        this.menu.style.top = `${Math.max(8, top)}px`;
    }

    private focusItem(index: number) {
        this.index = index;
        this.items.forEach((item, i) => item.classList.toggle('dbm-focused', i === index));
        this.items[index].focus({ preventScroll: true });
    }

    private onKey(event: KeyboardEvent) {
        const count = this.items.length;
        let handled = true;
        if (event.key === 'ArrowDown') {
            this.focusItem((this.index + 1) % count);
        } else if (event.key === 'ArrowUp') {
            this.focusItem((this.index + count - 1) % count);
        } else if (event.key === 'Home' || event.key === 'PageUp') {
            this.focusItem(0);
        } else if (event.key === 'End' || event.key === 'PageDown') {
            this.focusItem(count - 1);
        } else if (event.key === 'Enter') {
            this.pick(STATUS_ORDER[this.index]);
        } else if (event.key === 'Escape' || event.key === 'Tab') {
            this.cancel();
        } else if (!event.ctrlKey && !event.metaKey && !event.altKey && STATUS_KEYS[event.key]) {
            this.pick(STATUS_KEYS[event.key]);
        } else {
            handled = false;
        }
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    }
}
