FROM maxmcd/gstreamer:1.14-buster

RUN apt-get update -y
RUN apt-get install -y libjson-glib-dev
# RUN apk update
# RUN apk add json-glib-dev libsoup-dev

WORKDIR /opt/
COPY . /opt/

RUN make

CMD sleep 5 && ./webrtc-sendrecv \
    --peer-id=1 \
    --server=ws://localhost:8443 \
    --disable-ssl

