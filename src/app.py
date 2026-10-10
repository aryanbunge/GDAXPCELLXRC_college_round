import eel
import os
from queue import Queue

class ChatBot:

    started = False
    userinputQueue = Queue()

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
            eel.updateDevices(bool(microphone), bool(camera), bool(hand_control))
        except Exception:
            # The UI may still be starting or may already have been closed.
            pass

    def start():
        path = os.path.dirname(os.path.abspath(__file__))
        eel.init(path + r'\web', allowed_extensions=['.js', '.html'])
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
