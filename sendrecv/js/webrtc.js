/* vim: set sts=4 sw=4 et :
 *
 * Demo Javascript app for negotiating and streaming a sendrecv webrtc stream
 * with a GStreamer app. Runs only in passive mode, i.e., responds to offers
 * with answers, exchanges ICE candidates, and streams.
 *
 * Author: Nirbheek Chauhan <nirbheek@centricular.com>
 */

// Set this to override the automatic detection in websocketServerConnect()
var ws_server;
var ws_port;
// Set this to use a specific peer id instead of a random one
var default_peer_id = 2;
// Override with your own STUN servers if you want
var rtc_configuration = {iceServers: [{urls: "stun:stun.services.mozilla.com"},
                                      {urls: "stun:stun.l.google.com:19302"}]};
// The default constraints that will be attempted. Can be overriden by the user.
var default_constraints = {video: false, audio: false};

var connect_attempts = 0;
var peer_connection;
var send_channel;
var ws_conn;
// Promise for local stream after constraints are approved by the user
var local_stream_promise;

function getOurId() {
    return Math.floor(Math.random() * (9000 - 10) + 10).toString();
}

function resetState() {
    // This will call onServerClose()
    ws_conn.close();
}

function handleIncomingError(error) {
    setError("ERROR: " + error);
    resetState();
}

function getVideoElement() {
    return document.getElementById("stream");
}

function setStatus(text) {
    console.log(text);
    var span = document.getElementById("status")
    // Don't set the status if it already contains an error
    if (!span.classList.contains('error'))
        span.textContent = text;
}

function setError(text) {
    console.error(text);
    var span = document.getElementById("status")
    span.textContent = text;
    span.classList.add('error');
}

function resetVideo() {
    // Release the webcam and mic
    if (local_stream_promise)
        local_stream_promise.then(stream => {
            if (stream) {
                stream.getTracks().forEach(function (track) { track.stop(); });
            }
        });

    // Reset the video element and stop showing the last received frame
    var videoElement = getVideoElement();
    videoElement.pause();
    videoElement.src = "";
    videoElement.load();
}

// Local description was set, send it to peer
function onLocalDescription(desc) {
    console.log("Got local description: " + JSON.stringify(desc));
    peer_connection.setLocalDescription(desc).then(function() {
        setStatus("Sending SDP offer");
        sdp = {'sdp': peer_connection.localDescription}
        ws_conn.send(JSON.stringify(sdp));
    });
}

let candidates = []
let done = false

async function onServerMessage(event) {
    switch (event.data) {
        case "HELLO":
            setStatus("Registered with server, waiting for call");
            ws_conn.send(`SESSION 1`)
            return;
        case "SESSION_OK":
            createCall({});
            return;
        default:
            if (event.data.startsWith("ERROR")) {
                handleIncomingError(event.data);
                return;
            }
            // Handle incoming JSON SDP and ICE messages
            try {
                msg = JSON.parse(event.data);
            } catch (e) {
                if (e instanceof SyntaxError) {
                    handleIncomingError("Error parsing incoming JSON: " + event.data);
                } else {
                    handleIncomingError("Unknown error parsing response: " + event.data);
                }
                return;
            }

            if (msg.sdp != null) {
                console.log(msg.sdp, msg)
                const description = new RTCSessionDescription(msg.sdp)
                peer_connection.setRemoteDescription(description)
                    .then(() => {
                        console.log("setRemoteDescription: done")                      
                        done = true
                    })
            } 

            if(msg.ice) {
                console.log(msg.ice)
            }

            if(done) {
                if(candidates.length > 0) {
                    candidates.forEach(ice => {
                        peer_connection.addIceCandidate(new RTCIceCandidate(ice))
                    })
                    candidates = []
                }

                if (msg.ice != null) {
                    peer_connection.addIceCandidate(new RTCIceCandidate(msg.ice))
                }
            } else {
                if (msg.ice != null) {
                    candidates.push(msg.ice)
                }
            }
    }
}

function onServerClose(event) {
    setStatus('Disconnected from server');
    resetVideo();

    if (peer_connection) {
        peer_connection.close();
        peer_connection = null;
    }

    // Reset after a second
    window.setTimeout(websocketServerConnect, 1000);
}

function onServerError(event) {
    setError("Unable to connect to server, did you add an exception for the certificate?")
    // Retry after 3 seconds
    window.setTimeout(websocketServerConnect, 3000);
}

function getLocalStream() {
    var constraints;
    var textarea = document.getElementById('constraints');
    try {
        constraints = JSON.parse(textarea.value);
    } catch (e) {
        console.error(e);
        setError('ERROR parsing constraints: ' + e.message + ', using default constraints');
        constraints = default_constraints;
    }
    console.log(JSON.stringify(constraints));

    // Add local stream
    if (navigator.mediaDevices.getUserMedia) {
        return navigator.mediaDevices.getUserMedia(constraints);
    } else {
        errorUserMediaHandler();
    }
}

function websocketServerConnect() {
    connect_attempts++;
    if (connect_attempts > 3) {
        setError("Too many connection attempts, aborting. Refresh page to try again");
        return;
    }
    // Clear errors in the status span
    var span = document.getElementById("status");
    span.classList.remove('error');
    span.textContent = '';
    // Populate constraints
    var textarea = document.getElementById('constraints');
    if (textarea.value == '')
        textarea.value = JSON.stringify(default_constraints);
    // Fetch the peer id to use
    peer_id = default_peer_id || getOurId();
    ws_port = ws_port || '8443';
    if (window.location.protocol.startsWith ("file")) {
        ws_server = ws_server || "127.0.0.1";
    } else if (window.location.protocol.startsWith ("http")) {
        ws_server = ws_server || window.location.hostname;
    } else {
        throw new Error ("Don't know how to connect to the signalling server with uri" + window.location);
    }
    var ws_url = 'wss://' + ws_server + ':' + ws_port
    setStatus("Connecting to server " + ws_url);
    ws_conn = new WebSocket(ws_url);
    /* When connected, immediately register with the server */
    ws_conn.addEventListener('open', (event) => {
        document.getElementById("peer-id").textContent = peer_id;
        ws_conn.send('HELLO ' + peer_id);
        setStatus("Registering with server");
    });
    ws_conn.addEventListener('error', onServerError);
    ws_conn.addEventListener('message', onServerMessage);
    ws_conn.addEventListener('close', onServerClose);
}

function onRemoteStreamAdded(event) {
    debugger
    videoTracks = event.stream.getVideoTracks();
    audioTracks = event.stream.getAudioTracks();

    if (videoTracks.length > 0) {
        console.log('Incoming stream: ' + videoTracks.length + ' video tracks and ' + audioTracks.length + ' audio tracks');
        getVideoElement().srcObject = event.stream;
    } else {
        handleIncomingError('Stream with unknown tracks added, resetting');
    }
}

function errorUserMediaHandler() {
    setError("Browser doesn't support getUserMedia!");
}


function createCall() {
    // Reset connection attempts because we connected successfully
    connect_attempts = 0;

    peer_connection = new RTCPeerConnection(rtc_configuration);


    setInterval(() => {
        console.log(peer_connection.signalingState)
    }, 100)
    
    // peer_connection.ondatachannel = onDataChannel;
    peer_connection.onaddstream = () => {
        console.log("onAddStream")
    }
    peer_connection.addEventListener('track', onRemoteStreamAdded);
    // local_stream_promise = getLocalStream().then((stream) => {
    //     console.log('Adding local stream');
    //     peer_connection.addStream(stream);
     
    //     return stream;
    // }).catch(setError);
    peer_connection.createOffer(onLocalDescription, error => console.error(error), { 
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1,
    });
    

    peer_connection.onicecandidate = (event) => {
        // We have a candidate, send it to the remote party with the
        // same uuid
        if (event.candidate == null) {
            console.log("ICE Candidate was null, done");
            return;
        }
        console.log("sending canditate")
        ws_conn.send(JSON.stringify({'ice': event.candidate}));
    };
}
