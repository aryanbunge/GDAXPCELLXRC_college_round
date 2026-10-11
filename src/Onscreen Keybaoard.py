"""
On-screen dwell keyboard for Neo.

A small always-on-top keyboard that never takes focus from the window you are
typing into. Hold the pointer still over a key (Neo's dwell click) or click it
to type. Works with head, hand or mouse pointing.

    import onscreen_keyboard
    onscreen_keyboard.get().show() / .hide() / .toggle()
"""
import ctypes
import queue
import threading

ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Backspace'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'Enter'],
    ['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '.', ',', '?'],
    ['Hide', 'Tab', '@', '-', '/', ':', 'Space', 'Left', 'Right', 'Esc'],
]
# Relative key widths (default 1.0)
WIDTHS = {'Backspace': 2.0, 'Enter': 1.8, 'Shift': 1.6, 'Space': 4.0, 'Hide': 1.4, 'Tab': 1.2,
          'Left': 1.2, 'Right': 1.2, 'Esc': 1.2}
LABELS = {'Backspace': '\u232b', 'Enter': '\u21b5 Enter', 'Shift': '\u21e7 Shift', 'Space': 'Space',
          'Left': '\u2190', 'Right': '\u2192', 'Hide': 'Hide', 'Tab': 'Tab', 'Esc': 'Esc'}

BG = '#101722'
KEY_BG = '#1f2a3a'
KEY_FG = '#f4f1ea'
HOVER = '#3a5a8c'
ACTIVE = '#2a44f5'


class OnScreenKeyboard:
    def __init__(self):
        self._q = queue.Queue()
        self._thread = None
        self._lock = threading.Lock()
        self._rects = []
        self.visible = False
        self.error = None

    # ----- public API (safe to call from any thread) -----
    def show(self):
        self._send('show')

    def hide(self):
        self._send('hide')

    def toggle(self):
        self._send('toggle')

    def key_rects(self):
        """Key boxes in desktop pixels, for Neo's sticky targets."""
        with self._lock:
            return list(self._rects) if self.visible else []

    def _send(self, command):
        if not (self._thread and self._thread.is_alive()):
            self._thread = threading.Thread(target=self._run, name='neo-keyboard', daemon=True)
            self._thread.start()
        self._q.put(command)

    # ----- Tk thread -----
    def _run(self):
        try:
            import tkinter as tk
            import tkinter.font as tkfont
            from pynput.keyboard import Controller, Key
        except Exception as exc:
            self.error = str(exc)
            print('On-screen keyboard unavailable:', exc)
            return

        kb = Controller()
        root = tk.Tk()
        root.withdraw()
        root.overrideredirect(True)
        root.attributes('-topmost', True)
        try:
            root.attributes('-alpha', 0.95)
        except Exception:
            pass
        root.configure(bg=BG)

        screen_w, screen_h = root.winfo_screenwidth(), root.winfo_screenheight()
        total_units = max(sum(WIDTHS.get(k, 1.0) for k in row) for row in ROWS)
        win_w = int(min(screen_w * 0.66, 1500))
        pad = max(6, int(screen_h * 0.007))
        unit = (win_w - pad * (len(ROWS[0]) + 2)) / total_units
        key_h = int(min(unit * 0.95, screen_h * 0.085))
        win_h = len(ROWS) * (key_h + pad) + pad
        font = tkfont.Font(family='Segoe UI', size=-max(14, int(key_h * 0.34)), weight='bold')

        state = {'shift': False}
        buttons = {}

        def press(name):
            special = {'Backspace': Key.backspace, 'Enter': Key.enter, 'Tab': Key.tab, 'Esc': Key.esc,
                       'Left': Key.left, 'Right': Key.right}
            if name == 'Hide':
                root.withdraw()
                self._set_visible(False)
                return
            if name == 'Shift':
                state['shift'] = not state['shift']
                paint_shift()
                return
            try:
                if name in special:
                    kb.press(special[name])
                    kb.release(special[name])
                elif name == 'Space':
                    kb.type(' ')
                else:
                    kb.type(name.upper() if state['shift'] and name.isalpha() else name)
                    if state['shift']:
                        state['shift'] = False
                        paint_shift()
            except Exception as exc:
                print('Keyboard could not type:', exc)

        def paint_shift():
            b = buttons.get('Shift')
            if b:
                b.configure(bg=ACTIVE if state['shift'] else KEY_BG)
            for name, btn in buttons.items():
                if len(name) == 1 and name.isalpha():
                    btn.configure(text=name.upper() if state['shift'] else name)

        for r, row in enumerate(ROWS):
            frame = tk.Frame(root, bg=BG)
            frame.pack(pady=(pad, 0))
            for name in row:
                w_px = int(unit * WIDTHS.get(name, 1.0))
                holder = tk.Frame(frame, width=w_px, height=key_h, bg=BG)
                holder.pack_propagate(False)
                holder.pack(side='left', padx=pad // 2)
                btn = tk.Button(
                    holder, text=LABELS.get(name, name), font=font, bg=KEY_BG, fg=KEY_FG,
                    activebackground=HOVER, activeforeground=KEY_FG, bd=0, relief='flat',
                    takefocus=0, highlightthickness=0, command=lambda n=name: press(n),
                )
                btn.pack(fill='both', expand=True)
                buttons[name] = btn

        x = (screen_w - win_w) // 2
        y = screen_h - win_h - int(screen_h * 0.07)
        root.geometry('%dx%d+%d+%d' % (win_w, win_h, x, y))

        def no_activate():
            # WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW: clicking keys must not steal focus.
            try:
                user32 = ctypes.windll.user32
                root.update_idletasks()
                hwnd = user32.GetParent(root.winfo_id()) or root.winfo_id()
                style = user32.GetWindowLongW(hwnd, -20)
                user32.SetWindowLongW(hwnd, -20, style | 0x08000000 | 0x00000080)
            except Exception as exc:
                print('Could not make the keyboard non-activating:', exc)

        def update_rects():
            root.update_idletasks()
            rects = []
            for btn in buttons.values():
                rects.append([btn.winfo_rootx(), btn.winfo_rooty(),
                              btn.winfo_rootx() + btn.winfo_width(),
                              btn.winfo_rooty() + btn.winfo_height()])
            with self._lock:
                self._rects = rects

        def show():
            no_activate()
            root.deiconify()
            root.attributes('-topmost', True)
            update_rects()
            self._set_visible(True)

        def hide():
            root.withdraw()
            self._set_visible(False)

        def poll():
            try:
                while True:
                    command = self._q.get_nowait()
                    if command == 'show':
                        show()
                    elif command == 'hide':
                        hide()
                    elif command == 'toggle':
                        hide() if self.visible else show()
            except queue.Empty:
                pass
            root.after(80, poll)

        root.after(80, poll)
        root.mainloop()

    def _set_visible(self, value):
        with self._lock:
            self.visible = value
            if not value:
                self._rects = []


_keyboard = None


def get():
    global _keyboard
    if _keyboard is None:
        _keyboard = OnScreenKeyboard()
    return _keyboard