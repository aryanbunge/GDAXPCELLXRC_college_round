import eel
import os
from queue import Queue
import pyautogui

pyautogui.FAILSAFE = False
# pyautogui adds a default 100 ms pause after every call. Head tracking sends
# frequent position updates, so that pause creates a backlog and stale clicks.
pyautogui.PAUSE = 0
head_pointer_position = None

class ChatBot:

    started = False
    userinputQueue = Queue()
    microphone_active = True
    camera_active = False
    hand_control_active = False
    browser_tracker_active = False

    def isUserInput():
        return not ChatBot.userinputQueue.empty()

    def popUserInput():
        return ChatBot.userinputQueue.get()

    def close_callback(route, websockets):
        # if not websockets:
        #     print('Bye!')
        exit()

    @eel.expose
    def getUserInput(msg):
        ChatBot.userinputQueue.put(msg)
        print(msg)
    
    def close():
        ChatBot.started = False
    
    def addUserMsg(msg):
        eel.addUserMsg(msg)
    
    def addAppMsg(msg):
        eel.addAppMsg(msg)

    def setStatus(message, state='listening'):
        eel.updateStatus(message, state)

    def setDevices(microphone=True, camera=False, hand_control=False):
        try:
            ChatBot.microphone_active = bool(microphone)
            ChatBot.camera_active = bool(camera)
            ChatBot.hand_control_active = bool(hand_control)
            eel.updateDevices(bool(microphone), bool(camera), bool(hand_control))
        except Exception:
            # The UI may still be starting or may already have been closed.
            pass

    @eel.expose
    def setHeadTrackingActive(active):
        """Keep Python's mode state in sync with the browser-based face tracker."""
        global head_pointer_position
        try:
            import Gesture_Controller

            Gesture_Controller.Controller.set_head_tracking(bool(active))
            if active:
                head_pointer_position = None
            if not active:
                head_pointer_position = None
            ChatBot.browser_tracker_active = bool(active) or ChatBot.browser_tracker_active
            hand_active = bool(Gesture_Controller.GestureController.gc_mode)
            ChatBot.setDevices(
                ChatBot.microphone_active,
                ChatBot.browser_tracker_active or hand_active,
                hand_active,
            )
            message = 'Head tracking is active' if active else 'Head tracking is off'
            ChatBot.setStatus(message, 'tracking' if active else 'listening')
        except Exception as exc:
            print('Could not update head-tracking state:', exc)

    @eel.expose
    def setHeadTrackerCameraActive(active):
        """Track the browser camera independently of calibrated pointer control."""
        try:
            import Gesture_Controller

            ChatBot.browser_tracker_active = bool(active)
            if not active:
                Gesture_Controller.Controller.set_head_tracking(False)
            hand_active = bool(Gesture_Controller.GestureController.gc_mode)
            ChatBot.setDevices(
                ChatBot.microphone_active,
                bool(active) or hand_active,
                hand_active,
            )
        except Exception as exc:
            print('Could not update tracker camera state:', exc)

    @eel.expose
    def headTrackingMove(x, y, progress=0.0):
        """Move the native Windows pointer to Neo's existing UI ring position."""
        global head_pointer_position
        try:
            import Gesture_Controller

            if not Gesture_Controller.Controller.head_tracking_enabled:
                return
            px = int(float(x))
            py = int(float(y))
            width, height = pyautogui.size()
            px = max(0, min(width - 1, px))
            py = max(0, min(height - 1, py))
            head_pointer_position = (px, py)
            pyautogui.moveTo(px, py, duration=0)
        except Exception as exc:
            print('Could not move the head pointer:', exc)

    @eel.expose
    def headTrackingClick(x=None, y=None):
        """Click immediately at the desktop point whose dwell just completed."""
        global head_pointer_position
        try:
            import Gesture_Controller

            if Gesture_Controller.Controller.head_tracking_enabled:
                if x is not None and y is not None:
                    width, height = pyautogui.size()
                    px = max(0, min(width - 1, int(float(x))))
                    py = max(0, min(height - 1, int(float(y))))
                    head_pointer_position = (px, py)
                if head_pointer_position is None:
                    return
                pyautogui.click(*head_pointer_position)
        except Exception as exc:
            print('Could not click with the head pointer:', exc)

    def start():
        path = os.path.dirname(os.path.abspath(__file__))
        eel.init(path + r'\web', allowed_extensions=[
            '.js', '.html', '.css', '.mjs', '.wasm', '.json', '.task',
        ])
        try:
            eel.start('index.html', mode='chrome',
                                    host='localhost',
                                    # Eel chooses a free loopback port for every launch.
                                    port=0,
                                    block=False,
                                    size=(1040, 800),
                                    position=(80,60),
                                    disable_cache=True,
                                    close_callback=ChatBot.close_callback)
            ChatBot.started = True
            while ChatBot.started:
                try:
                    eel.sleep(10.0)
                except:
                    #main thread exited
                    break
        
        except Exception as exc:
            ChatBot.started = False
            print('Neo window failed to start:', exc)
