# Imports

import cv2
import mediapipe as mp
import pyautogui
import math
from enum import IntEnum
from ctypes import cast, POINTER
from comtypes import CLSCTX_ALL
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
from google.protobuf.json_format import MessageToDict
import screen_brightness_control as sbcontrol

pyautogui.FAILSAFE = False
mp_drawing = mp.solutions.drawing_utils
mp_hands = mp.solutions.hands

# Gesture Encodings 
class Gest(IntEnum):
    # Binary Encoded
    """
    Enum for mapping all hand gesture to binary number.
    """

    FIST = 0
    PINKY = 1
    RING = 2
    MID = 4
    LAST3 = 7
    INDEX = 8
    FIRST2 = 12
    LAST4 = 15
    THUMB = 16    
    PALM = 31
    
    # Extra Mappings
    V_GEST = 33
    TWO_FINGER_CLOSED = 34
    PINCH_MAJOR = 35
    PINCH_MINOR = 36

# Multi-handedness Labels
class HLabel(IntEnum):
    MINOR = 0
    MAJOR = 1

# Convert Mediapipe Landmarks to recognizable Gestures
class HandRecog:
    """
    Convert Mediapipe Landmarks to recognizable Gestures.
    """
    
    def __init__(self, hand_label):
        """
        Constructs all the necessary attributes for the HandRecog object.

        Parameters
        ----------
            finger : int
                Represent gesture corresponding to Enum 'Gest',
                stores computed gesture for current frame.
            ori_gesture : int
                Represent gesture corresponding to Enum 'Gest',
                stores gesture being used.
            prev_gesture : int
                Represent gesture corresponding to Enum 'Gest',
                stores gesture computed for previous frame.
            frame_count : int
                total no. of frames since 'ori_gesture' is updated.
            hand_result : Object
                Landmarks obtained from mediapipe.
            hand_label : int
                Represents multi-handedness corresponding to Enum 'HLabel'.
        """

        self.finger = 0
        self.ori_gesture = Gest.PALM
        self.prev_gesture = Gest.PALM
        self.frame_count = 0
        self.hand_result = None
        self.hand_label = hand_label
    
    def update_hand_result(self, hand_result):
        self.hand_result = hand_result

    def get_signed_dist(self, point):
        """
        returns signed euclidean distance between 'point'.

        Parameters
        ----------
        point : list contaning two elements of type list/tuple which represents 
            landmark point.
        
        Returns
        -------
        float
        """
        sign = -1
        if self.hand_result.landmark[point[0]].y < self.hand_result.landmark[point[1]].y:
            sign = 1
        dist = (self.hand_result.landmark[point[0]].x - self.hand_result.landmark[point[1]].x)**2
        dist += (self.hand_result.landmark[point[0]].y - self.hand_result.landmark[point[1]].y)**2
        dist = math.sqrt(dist)
        return dist*sign
    
    def get_dist(self, point):
        """
        returns euclidean distance between 'point'.

        Parameters
        ----------
        point : list contaning two elements of type list/tuple which represents 
            landmark point.
        
        Returns
        -------
        float
        """
        dist = (self.hand_result.landmark[point[0]].x - self.hand_result.landmark[point[1]].x)**2
        dist += (self.hand_result.landmark[point[0]].y - self.hand_result.landmark[point[1]].y)**2
        dist = math.sqrt(dist)
        return dist
    
    def get_dz(self,point):
        """
        returns absolute difference on z-axis between 'point'.

        Parameters
        ----------
        point : list contaning two elements of type list/tuple which represents 
            landmark point.
        
        Returns
        -------
        float
        """
        return abs(self.hand_result.landmark[point[0]].z - self.hand_result.landmark[point[1]].z)
    
    # Function to find Gesture Encoding using current finger_state.
    # Finger_state: 1 if finger is open, else 0
    def set_finger_state(self):
        """
        set 'finger' by computing ratio of distance between finger tip 
        , middle knuckle, base knuckle.

        Returns
        -------
        None
        """
        if self.hand_result == None:
            return

        points = [[8,5,0],[12,9,0],[16,13,0],[20,17,0]]
        self.finger = 0
        self.finger = self.finger | 0 #thumb
        for idx,point in enumerate(points):
            
            dist = self.get_signed_dist(point[:2])
            dist2 = self.get_signed_dist(point[1:])
            
            try:
                ratio = round(dist/dist2,1)
            except:
                ratio = round(dist1/0.01,1)

            self.finger = self.finger << 1
            if ratio > 0.5 :
                self.finger = self.finger | 1
    

    # Handling Fluctations due to noise
    def get_gesture(self):
        """
        returns int representing gesture corresponding to Enum 'Gest'.
        sets 'frame_count', 'ori_gesture', 'prev_gesture', 
        handles fluctations due to noise.
        
        Returns
        -------
        int
        """
        if self.hand_result == None:
            return Gest.PALM

        current_gesture = Gest.PALM
        if self.finger in [Gest.LAST3,Gest.LAST4] and self.get_dist([8,4]) < 0.05:
            if self.hand_label == HLabel.MINOR :
                current_gesture = Gest.PINCH_MINOR
            else:
                current_gesture = Gest.PINCH_MAJOR

        elif Gest.FIRST2 == self.finger :
            point = [[8,12],[5,9]]
            dist1 = self.get_dist(point[0])
            dist2 = self.get_dist(point[1])
            ratio = dist1/dist2
            if ratio > 1.7:
                current_gesture = Gest.V_GEST
            else:
                if self.get_dz([8,12]) < 0.1:
                    current_gesture =  Gest.TWO_FINGER_CLOSED
                else:
                    current_gesture =  Gest.MID
            
        else:
            current_gesture =  self.finger
        
        if current_gesture == self.prev_gesture:
            self.frame_count += 1
        else:
            self.frame_count = 0

        self.prev_gesture = current_gesture

        if self.frame_count > 4 :
            self.ori_gesture = current_gesture
        return self.ori_gesture

# Executes commands according to detected gestures
class Controller:
    calibration_requested = False
    """
    Executes commands according to detected gestures.

    Attributes
    ----------
    tx_old : int
        previous mouse location x coordinate
    ty_old : int
        previous mouse location y coordinate
    flag : bool
        true if V gesture is detected
    grabflag : bool
        true if FIST gesture is detected
    pinchmajorflag : bool
        true if PINCH gesture is detected through MAJOR hand,
        on x-axis 'Controller.changesystembrightness', 
        on y-axis 'Controller.changesystemvolume'.
    pinchminorflag : bool
        true if PINCH gesture is detected through MINOR hand,
        on x-axis 'Controller.scrollHorizontal', 
        on y-axis 'Controller.scrollVertical'.
    pinchstartxcoord : int
        x coordinate of hand landmark when pinch gesture is started.
    pinchstartycoord : int
        y coordinate of hand landmark when pinch gesture is started.
    pinchaxis : str
        dominant movement axis selected relative to the pinch start point.
    pinchdirectionflag : bool
        true if pinch gesture movment is along x-axis,
        otherwise false
    pinchlv : int
        stores pinch displacement since the previous control step.
    pinchlastx, pinchlasty : float
        last applied horizontal and vertical pinch displacements.
    prev_hand : tuple
        stores (x, y) coordinates of hand in previous frame.
    pinch_threshold : float
        step size for quantization of 'pinchlv'.
    """

    tx_old = 0
    ty_old = 0
    trial = True
    flag = False
    grabflag = False
    pinchmajorflag = False
    pinchminorflag = False
    pinchstartxcoord = None
    pinchstartycoord = None
    pinchdirectionflag = None
    pinchaxis = None
    pinchlv = 0
    pinchlastx = 0
    pinchlasty = 0
    prev_hand = None
    pinch_threshold = 0.25
    scroll_gain = 16
    max_scroll_steps = 24
    
    def getpinchylv(hand_result):
        """returns distance beween starting pinch y coord and current hand position y coord."""
        dist = round((Controller.pinchstartycoord - hand_result.landmark[8].y)*10,1)
        return dist

    def getpinchxlv(hand_result):
        """returns distance beween starting pinch x coord and current hand position x coord."""
        dist = round((hand_result.landmark[8].x - Controller.pinchstartxcoord)*10,1)
        return dist
    
    def changesystembrightness():
        """sets system brightness based on 'Controller.pinchlv'."""
        currentBrightnessLv = sbcontrol.get_brightness(display=0)/100.0
        currentBrightnessLv += Controller.pinchlv/20.0
        if currentBrightnessLv > 1.0:
            currentBrightnessLv = 1.0
        elif currentBrightnessLv < 0.0:
            currentBrightnessLv = 0.0       
        sbcontrol.set_brightness(int(100*currentBrightnessLv), display=0)
    
    def changesystemvolume():
        """sets system volume based on 'Controller.pinchlv'."""
        devices = AudioUtilities.GetSpeakers()
        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume = cast(interface, POINTER(IAudioEndpointVolume))
        currentVolumeLv = volume.GetMasterVolumeLevelScalar()
        currentVolumeLv += Controller.pinchlv/20.0
        if currentVolumeLv > 1.0:
            currentVolumeLv = 1.0
        elif currentVolumeLv < 0.0:
            currentVolumeLv = 0.0
        volume.SetMasterVolumeLevelScalar(currentVolumeLv, None)

    def adjust_volume_percent(delta):
        """Apply a bounded voice-command volume adjustment."""
        devices = AudioUtilities.GetSpeakers()
        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume = cast(interface, POINTER(IAudioEndpointVolume))
        current = volume.GetMasterVolumeLevelScalar()
        volume.SetMasterVolumeLevelScalar(max(0.0, min(1.0, current + delta / 100.0)), None)

    def set_volume_percent(value):
        devices = AudioUtilities.GetSpeakers()
        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume = cast(interface, POINTER(IAudioEndpointVolume))
        volume.SetMasterVolumeLevelScalar(max(0.0, min(1.0, value / 100.0)), None)

    def adjust_brightness_percent(delta):
        current = sbcontrol.get_brightness(display=0)
        if isinstance(current, list):
            current = current[0]
        sbcontrol.set_brightness(max(0, min(100, int(current) + delta)), display=0)

    def set_brightness_percent(value):
        sbcontrol.set_brightness(max(0, min(100, int(value))), display=0)
    
    def scrollVertical():
        """scrolls on screen vertically."""
        steps = min(Controller.max_scroll_steps,
                    max(1, int(round(abs(Controller.pinchlv) * Controller.scroll_gain))))
        pyautogui.scroll(steps if Controller.pinchlv > 0.0 else -steps)
        
    
    def scrollHorizontal():
        """scrolls on screen horizontally."""
        steps = min(Controller.max_scroll_steps,
                    max(1, int(round(abs(Controller.pinchlv) * Controller.scroll_gain))))
        pyautogui.keyDown('shift')
        try:
            pyautogui.scroll(-steps if Controller.pinchlv > 0.0 else steps)
        finally:
            pyautogui.keyUp('shift')

    # Locate Hand to get Cursor Position
    # Stabilize cursor by Dampening
    def get_position(hand_result):
        """
        returns coordinates of current hand position.

        Locates hand to get cursor position also stabilize cursor by 
        dampening jerky motion of hand.

        Returns
        -------
        tuple(float, float)
        """
        point = 9
        position = [hand_result.landmark[point].x ,hand_result.landmark[point].y]
        sx,sy = pyautogui.size()
        x_old,y_old = pyautogui.position()
        x = int(position[0]*sx)
        y = int(position[1]*sy)
        if Controller.prev_hand is None:
            Controller.prev_hand = x,y
        delta_x = x - Controller.prev_hand[0]
        delta_y = y - Controller.prev_hand[1]

        distsq = delta_x**2 + delta_y**2
        # Hand tracking can briefly jump to a bad landmark. Ignore that frame
        # instead of flinging the cursor toward a screen corner.
        if distsq > 100**2:
            Controller.prev_hand = [x, y]
            return x_old, y_old
        ratio = 1
        Controller.prev_hand = [x,y]

        if distsq <= 25:
            ratio = 0
        elif distsq <= 900:
            ratio = 0.07 * (distsq ** (1/2))
        else:
            ratio = 2.1
        x = max(0, min(sx - 1, int(x_old + delta_x * ratio)))
        y = max(0, min(sy - 1, int(y_old + delta_y * ratio)))
        return (x,y)

    def pinch_control_init(hand_result):
        """Initializes attributes for pinch gesture."""
        Controller.pinchstartxcoord = hand_result.landmark[8].x
        Controller.pinchstartycoord = hand_result.landmark[8].y
        Controller.pinchlv = 0
        Controller.pinchlastx = 0
        Controller.pinchlasty = 0
        Controller.pinchaxis = None
        Controller.pinchdirectionflag = None

    def reset_pinch_control():
        """Clear the pinch anchor so the next pinch starts at displacement zero."""
        Controller.pinchmajorflag = False
        Controller.pinchminorflag = False
        Controller.pinchstartxcoord = None
        Controller.pinchstartycoord = None
        Controller.pinchlastx = 0
        Controller.pinchlasty = 0
        Controller.pinchlv = 0
        Controller.pinchaxis = None
        Controller.pinchdirectionflag = None

    def request_calibration():
        """Rebase hand movement and pinch state on the next camera frame."""
        Controller.calibration_requested = True

    def pinch_control(hand_result, controlHorizontal, controlVertical):
        """
        Applies a control step when the pinch moves beyond the noise threshold.

        Parameters
        ----------
        hand_result : Object
            Landmarks obtained from mediapipe.
        controlHorizontal : callback function assosiated with horizontal
            pinch gesture.
        controlVertical : callback function assosiated with vertical
            pinch gesture. 
        
        Returns
        -------
        None
        """
        # Compare total displacement from this pinch's zero point, not the
        # frame-to-frame delta. Lock to the dominant axis to avoid jitter.
        lvx = Controller.getpinchxlv(hand_result)
        lvy = Controller.getpinchylv(hand_result)
        if Controller.pinchaxis is None:
            if max(abs(lvx), abs(lvy)) < Controller.pinch_threshold:
                return
            Controller.pinchaxis = 'horizontal' if abs(lvx) > abs(lvy) else 'vertical'
            Controller.pinchdirectionflag = Controller.pinchaxis == 'horizontal'

        if Controller.pinchaxis == 'vertical':
            delta = lvy - Controller.pinchlasty
            if abs(delta) >= Controller.pinch_threshold:
                Controller.pinchlv = delta
                Controller.pinchlasty = lvy
                Controller.pinchlastx = lvx
                controlVertical()
        else:
            delta = lvx - Controller.pinchlastx
            if abs(delta) >= Controller.pinch_threshold:
                Controller.pinchlv = delta
                Controller.pinchlastx = lvx
                Controller.pinchlasty = lvy
                controlHorizontal()

    def handle_controls(gesture, hand_result):  
        """Impliments all gesture functionality."""      
        x,y = None,None
        if gesture != Gest.PALM :
            x,y = Controller.get_position(hand_result)
        
        # flag reset
        if gesture != Gest.FIST and Controller.grabflag:
            Controller.grabflag = False
            pyautogui.mouseUp(button = "left")

        if gesture != Gest.PINCH_MAJOR and Controller.pinchmajorflag:
            Controller.pinchmajorflag = False

        if gesture != Gest.PINCH_MINOR and Controller.pinchminorflag:
            Controller.pinchminorflag = False

        # implementation
        if gesture == Gest.V_GEST:
            Controller.flag = True
            pyautogui.moveTo(x, y, duration = 0.1)

        elif gesture == Gest.FIST:
            if not Controller.grabflag : 
                Controller.grabflag = True
                pyautogui.mouseDown(button = "left")
            pyautogui.moveTo(x, y, duration = 0.1)

        elif gesture == Gest.MID and Controller.flag:
            pyautogui.click()
            Controller.flag = False

        elif gesture == Gest.INDEX and Controller.flag:
            pyautogui.click(button='right')
            Controller.flag = False

        elif gesture == Gest.TWO_FINGER_CLOSED and Controller.flag:
            pyautogui.doubleClick()
            Controller.flag = False

        elif gesture == Gest.PINCH_MINOR:
            if Controller.pinchminorflag == False:
                Controller.pinch_control_init(hand_result)
                Controller.pinchminorflag = True
            Controller.pinch_control(hand_result,Controller.scrollHorizontal, Controller.scrollVertical)
        
        elif gesture == Gest.PINCH_MAJOR:
            if Controller.pinchmajorflag == False:
                Controller.pinch_control_init(hand_result)
                Controller.pinchmajorflag = True
            Controller.pinch_control(hand_result,Controller.changesystembrightness, Controller.changesystemvolume)


def get_gesture_feedback(gesture):
    """Return readable gesture and action text for the webcam preview."""
    if gesture == Gest.V_GEST:
        return "V sign", "Move cursor"
    if gesture == Gest.FIST:
        return "Fist", "Drag (left mouse button held)"
    if gesture == Gest.MID:
        if Controller.flag:
            return "Middle finger", "Left click"
        return "Middle finger", "No click armed; show the V sign first"
    if gesture == Gest.INDEX:
        if Controller.flag:
            return "Index finger", "Right click"
        return "Index finger", "No click armed; show the V sign first"
    if gesture == Gest.TWO_FINGER_CLOSED:
        if Controller.flag:
            return "Index and middle fingers together", "Double click"
        return "Index and middle fingers together", "No click armed; show the V sign first"
    if gesture == Gest.PINCH_MINOR:
        if Controller.pinchdirectionflag is True:
            return "Left-hand pinch", "Horizontal scroll"
        if Controller.pinchdirectionflag is False:
            return "Left-hand pinch", "Vertical scroll"
        return "Left-hand pinch", "Move sideways to scroll horizontally or up/down vertically"
    if gesture == Gest.PINCH_MAJOR:
        if Controller.pinchdirectionflag is True:
            return "Right-hand pinch", "Adjust brightness"
        if Controller.pinchdirectionflag is False:
            return "Right-hand pinch", "Adjust volume"
        return "Right-hand pinch", "Move sideways for brightness or up/down for volume"
    if gesture == Gest.PALM:
        return "Neutral", "No action"
    if gesture == Gest.LAST4:
        return "Four fingers extended", "No action mapped (open-palm neutral is not recognized)"
    if gesture == Gest.LAST3:
        return "Three fingers extended", "No action"
    if gesture == Gest.PINKY:
        return "Pinky finger", "No action"
    if gesture == Gest.RING:
        return "Ring finger", "No action"
    return "Unmapped pose", "No action"


def draw_gesture_feedback(image, gesture, hand_name="Right hand", action_override=None,
                          feedback=None):
    """Show the stabilized gesture and mapped action on the camera frame."""
    if feedback is None:
        feedback = get_gesture_feedback(gesture)
    gesture_text, action_text = feedback
    if action_override is not None:
        action_text = action_override
    lines = ["Detected: " + hand_name + " - " + gesture_text,
             "Action: " + action_text]
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.55
    line_height = 25
    padding = 10
    widths = [cv2.getTextSize(line, font, font_scale, 1)[0][0] for line in lines]
    panel_width = min(max(widths) + padding * 2, image.shape[1] - 1)
    panel_height = line_height * len(lines) + padding
    cv2.rectangle(image, (0, 0), (panel_width, panel_height), (25, 25, 25), -1)
    for index, line in enumerate(lines):
        cv2.putText(image, line, (padding, padding + line_height * (index + 1) - 5),
                    font, font_scale, (80, 255, 120), 1, cv2.LINE_AA)
        
'''
----------------------------------------  Main Class  ----------------------------------------
    Entry point of Gesture Controller
'''


class GestureController:
    """
    Handles camera, obtain landmarks from mediapipe, entry point
    for whole program.

    Attributes
    ----------
    gc_mode : int
        indicates weather gesture controller is running or not,
        1 if running, otherwise 0.
    cap : Object
        object obtained from cv2, for capturing video frame.
    CAM_HEIGHT : int
        highet in pixels of obtained frame from camera.
    CAM_WIDTH : int
        width in pixels of obtained frame from camera.
    hr_major : Object of 'HandRecog'
        object representing major hand.
    hr_minor : Object of 'HandRecog'
        object representing minor hand.
    dom_hand : bool
        True if right hand is domaniant hand, otherwise False.
        default True.
    """
    gc_mode = 0
    cap = None
    CAM_HEIGHT = None
    CAM_WIDTH = None
    hr_major = None # Right Hand by default
    hr_minor = None # Left hand by default
    dom_hand = True

    def __init__(self):
        """Initilaizes attributes."""
        GestureController.gc_mode = 1
        GestureController.cap = cv2.VideoCapture(0)
        if not GestureController.cap.isOpened():
            GestureController.cap.release()
            GestureController.cap = None
            GestureController.gc_mode = 0
            raise RuntimeError("Neo could not access the webcam. Check that it is connected and not in use by another app.")
        GestureController.CAM_HEIGHT = GestureController.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        GestureController.CAM_WIDTH = GestureController.cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    
    def classify_hands(results):
        """
        sets 'hr_major', 'hr_minor' based on classification(left, right) of 
        hand obtained from mediapipe, uses 'dom_hand' to decide major and
        minor hand.
        """
        left , right = None,None
        try:
            handedness_dict = MessageToDict(results.multi_handedness[0])
            if handedness_dict['classification'][0]['label'] == 'Right':
                right = results.multi_hand_landmarks[0]
            else :
                left = results.multi_hand_landmarks[0]
        except:
            pass

        try:
            handedness_dict = MessageToDict(results.multi_handedness[1])
            if handedness_dict['classification'][0]['label'] == 'Right':
                right = results.multi_hand_landmarks[1]
            else :
                left = results.multi_hand_landmarks[1]
        except:
            pass
        
        if GestureController.dom_hand == True:
            GestureController.hr_major = right
            GestureController.hr_minor = left
        else :
            GestureController.hr_major = left
            GestureController.hr_minor = right

    def start(self):
        """
        Entry point of whole programm, caputres video frame and passes, obtains
        landmark from mediapipe and passes it to 'handmajor' and 'handminor' for
        controlling.
        """
        
        handmajor = HandRecog(HLabel.MAJOR)
        handminor = HandRecog(HLabel.MINOR)

        with mp_hands.Hands(max_num_hands = 2,min_detection_confidence=0.5, min_tracking_confidence=0.5) as hands:
            while GestureController.cap.isOpened() and GestureController.gc_mode:
                success, image = GestureController.cap.read()

                if not success:
                    print("Ignoring empty camera frame.")
                    continue

                if Controller.calibration_requested:
                    Controller.prev_hand = None
                    Controller.reset_pinch_control()
                    Controller.calibration_requested = False
                
                image = cv2.cvtColor(cv2.flip(image, 1), cv2.COLOR_BGR2RGB)
                image.flags.writeable = False
                results = hands.process(image)
                
                image.flags.writeable = True
                image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

                display_gesture = Gest.PALM
                display_hand_name = "Right hand"
                display_action_override = None
                display_feedback = None
                if results.multi_hand_landmarks:
                    GestureController.classify_hands(results)
                    handmajor.update_hand_result(GestureController.hr_major)
                    handminor.update_hand_result(GestureController.hr_minor)

                    handmajor.set_finger_state()
                    handminor.set_finger_state()
                    gest_name = handminor.get_gesture()

                    if gest_name == Gest.PINCH_MINOR:
                        display_gesture = gest_name
                        display_hand_name = "Left hand"
                        display_feedback = get_gesture_feedback(display_gesture)
                        Controller.handle_controls(gest_name, handminor.hand_result)
                    else:
                        gest_name = handmajor.get_gesture()
                        if handmajor.hand_result is None and handminor.hand_result is not None:
                            display_hand_name = "Left hand"
                            display_action_override = "Only pinch scrolling is active for this hand"
                        else:
                            display_hand_name = "Right hand"
                            display_gesture = gest_name
                        display_feedback = get_gesture_feedback(display_gesture)
                        if display_action_override is not None:
                            display_feedback = (display_feedback[0], display_action_override)
                        Controller.handle_controls(gest_name, handmajor.hand_result)
                    
                    for hand_landmarks in results.multi_hand_landmarks:
                        mp_drawing.draw_landmarks(image, hand_landmarks, mp_hands.HAND_CONNECTIONS)
                else:
                    Controller.prev_hand = None
                    Controller.reset_pinch_control()
                    display_hand_name = "No hand"
                if display_hand_name == "No hand":
                    cv2.putText(image, "No hand detected", (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                                0.7, (0, 0, 255), 2, cv2.LINE_AA)
                    cv2.putText(image, "Keep your hand in frame with good light", (10, 60),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 1, cv2.LINE_AA)
                else:
                    draw_gesture_feedback(image, display_gesture, display_hand_name,
                                          display_action_override, display_feedback)
                cv2.imshow('Gesture Controller', image)
                if cv2.waitKey(5) & 0xFF == 13:
                    break
        GestureController.cap.release()
        GestureController.cap = None
        GestureController.gc_mode = 0
        cv2.destroyAllWindows()

# uncomment to run directly
# gc1 = GestureController()
# gc1.start()
