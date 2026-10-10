// Timer in a worker: not slowed down when the tracker window is covered.
let id = null;
onmessage = (e) => { clearInterval(id); if (e.data && e.data.ms) id = setInterval(() => postMessage(1), e.data.ms); };
