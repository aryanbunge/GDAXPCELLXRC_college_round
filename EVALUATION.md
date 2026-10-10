# Hands-free performance evaluation

This protocol compares Neo's voice and hand controls with ordinary mouse and
keyboard input. It needs no extra software. Record one row per task attempt in
a spreadsheet using the fields below; include the raw transcript so voice
recognition and command interpretation can be reviewed separately.

## Measures

- **Task completion time (seconds):** start when the task instruction is read;
  stop when the intended result is visibly complete. Report the median and
  range for each input method. Use the same browser, network, and task order
  for both methods.
- **Voice-command accuracy:** commands that produced the intended action /
  spoken command attempts. Also record whether the transcript itself was
  correct. This separates speech-to-text errors from command-routing errors.
- **Selection error rate:** incorrect or failed selections / all selection
  attempts. A selection attempt includes a spoken activation or the existing
  armed hand click. Count a wrong target and a missed target as errors.
- **Accidental activations:** unintended computer actions during a quiet idle
  period. Report both the count and unintended actions per idle minute.

Suggested CSV header:

```text
participant,session,input_mode,task,attempt,started_at,finished_at,elapsed_seconds,expected_command,transcript,transcript_correct,command_correct,selection_attempt,selection_correct,unintended_action,notes
```

Use `input_mode` values `mouse_keyboard` and `neo_voice_hand`. Store
`transcript_correct`, `command_correct`, `selection_attempt`,
`selection_correct`, and `unintended_action` as `1` or `0`; leave selection
fields empty for tasks that do not involve selecting a control. Compute elapsed time as
`finished_at - started_at`. For command accuracy, divide the sum of
`command_correct` by the number of command rows. For selection error rate,
divide incorrect selection attempts by all selection attempts. Keep the raw
attempt count beside every percentage.

## Reproduce the comparison

1. Use the same Windows laptop, display, room, browser, and web pages in both
   conditions. Keep the laptop brightness and system volume fixed. Use a
   non-personal test page, such as the Wikipedia home page, and do not dictate
   passwords or private data.
2. Give each participant one practice round per method. Record three measured
   attempts per task and method. Alternate the method order between rounds to
   reduce learning and fatigue effects.
3. Measure these tasks: (a) open a named website; (b) go back and forward;
   (c) move to a visible link or control with Tab/Shift+Tab and activate it;
   (d) scroll to a named section; and (e) focus a search field, dictate a short
   phrase, and submit it. Read task instructions the same way each time.
4. For the conventional condition, use only mouse and keyboard. For Neo, start
   hand control, point with the V-sign cursor, and activate by the deliberate
   hand click gesture or by saying “Neo, click”. Use “next control” and
   “select” to test keyboard-accessible targets. Record which activation method
   was used.
5. Run a five-minute idle trial with Neo listening for its wake word but with
   no spoken commands and the camera off. Then repeat for five minutes with
   hand control on and hands resting naturally in the camera frame. Count every
   action Neo triggers by mistake in each condition. Repeat once with Neo
   closed to capture unrelated OS or background events, and report those
   separately.
6. Report per-method task-time medians, command accuracy with its denominator,
   selection error rate with its denominator, and accidental activations per
   minute. Keep failed attempts and timeouts in the results; do not silently
   discard them.

## Scope and interpretation

Neo currently moves the pointer with the repository's MediaPipe hand path;
there is no head-pose cursor implementation yet. Voice recognition uses
Google Speech Recognition, so transcript accuracy depends on network quality,
accent, and room noise. The recognizer adapts its energy threshold while it
listens. Gesture recognition uses MediaPipe's existing confidence settings and
shows a camera preview; move into good light and keep the hand in frame when
tracking is lost.

Browser actions are sent through Windows keyboard and pointer input to the
default browser. Neo does not inject an extension or inspect arbitrary page
DOM, so named-link selection is limited to browser/page keyboard navigation
and pointing at the visible target. Tab order varies by website. Log this as a
compatibility limitation when comparing sites.
