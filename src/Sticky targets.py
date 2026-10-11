"""
Sticky targets: finds clickable controls in the foreground window.

Uses Windows UI Automation on a background thread, about once a second, and keeps
the boxes (desktop pixels) in memory. The head-tracking UI asks for them and
slows the cursor down near them.

Everything here is best effort. If UI Automation is unavailable or a scan fails,
no targets are returned and the cursor simply behaves as before.
Set the environment variable NEO_STICKY=0 to turn scanning off.
"""
import threading
import time

MAX_TARGETS = 250
SCAN_EVERY = 0.9      # seconds between scans
MAX_DUTY = 0.2        # never spend more than ~20% of the time scanning

# UI Automation property ids
_BOUNDING_RECT = 30001
_IS_OFFSCREEN = 30022
_IS_EXPAND_COLLAPSE = 30028
_IS_INVOKE = 30031
_IS_SELECTION_ITEM = 30036
_IS_TOGGLE = 30041
_TREE_DESCENDANTS = 4


class StickyScanner:
    def __init__(self):
        self._targets = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self.error = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name='neo-sticky-scan', daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        with self._lock:
            self._targets = []

    def targets(self):
        with self._lock:
            return list(self._targets)

    def _set(self, boxes):
        with self._lock:
            self._targets = boxes

    def _run(self):
        try:
            import comtypes
            import comtypes.client
            import win32api
            import win32gui
            try:
                comtypes.CoInitializeEx(0)
            except Exception:
                try:
                    comtypes.CoInitialize()
                except Exception:
                    pass
            comtypes.client.GetModule('UIAutomationCore.dll')
            from comtypes.gen import UIAutomationClient as UIA
            uia = comtypes.CoCreateInstance(
                UIA.CUIAutomation._reg_clsid_,
                interface=UIA.IUIAutomation,
                clsctx=comtypes.CLSCTX_INPROC_SERVER,
            )

            def prop(pid, value):
                return uia.CreatePropertyCondition(pid, value)

            clickable = uia.CreateOrCondition(
                uia.CreateOrCondition(prop(_IS_INVOKE, True), prop(_IS_TOGGLE, True)),
                uia.CreateOrCondition(prop(_IS_SELECTION_ITEM, True), prop(_IS_EXPAND_COLLAPSE, True)),
            )
            condition = uia.CreateAndCondition(clickable, prop(_IS_OFFSCREEN, False))
            cache = uia.CreateCacheRequest()
            cache.AddProperty(_BOUNDING_RECT)
        except Exception as exc:
            self.error = 'UI Automation is not available: %s' % exc
            print('Sticky targets disabled:', self.error)
            return

        screen_w = win32api.GetSystemMetrics(0)
        screen_h = win32api.GetSystemMetrics(1)
        last_hwnd = 0
        while not self._stop.is_set():
            started = time.time()
            try:
                hwnd = win32gui.GetForegroundWindow()
                if hwnd != last_hwnd:
                    self._set([])          # window changed: old boxes are stale
                    last_hwnd = hwnd
                if hwnd:
                    root = uia.ElementFromHandle(hwnd)
                    found = root.FindAllBuildCache(_TREE_DESCENDANTS, condition, cache)
                    boxes = []
                    for i in range(min(found.Length, MAX_TARGETS * 3)):
                        r = found.GetElement(i).CachedBoundingRectangle
                        w, h = r.right - r.left, r.bottom - r.top
                        if w < 8 or h < 8:
                            continue
                        if w * h > 0.6 * screen_w * screen_h:
                            continue
                        boxes.append([int(r.left), int(r.top), int(r.right), int(r.bottom)])
                        if len(boxes) >= MAX_TARGETS:
                            break
                    if win32gui.GetForegroundWindow() == hwnd:
                        self._set(boxes)
            except Exception as exc:
                self.error = str(exc)
                self._set([])
            cost = time.time() - started
            # Slow pages cost more, so wait longer and keep CPU use low.
            self._stop.wait(max(SCAN_EVERY, cost / MAX_DUTY - cost))


_scanner = None


def get():
    global _scanner
    if _scanner is None:
        _scanner = StickyScanner()
    return _scanner