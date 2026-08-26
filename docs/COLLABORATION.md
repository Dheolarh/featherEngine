# Live Collaboration

Feather desktop can host a live editing session from the project owner's computer. The native app
binds a relay only to `127.0.0.1`, then exposes it through an encrypted ngrok endpoint created with
the host's own ngrok authtoken. Feather does not require or operate a cloud collaboration server.

## Start a session

1. Open the project in the Feather desktop app and stop Play mode.
2. Select **Collaborate** in the toolbar, then **Start a session**.
3. Enter a display name, session name, ngrok authtoken, and the default guest role.
4. Copy the private invite link and send it only to collaborators you trust.

The ngrok authtoken is held in component/native command memory only. It is not written to the
project, browser storage, logs, or Feather preferences. ngrok account limits and charges still
apply to the tunnel.

## Join a session

Select **Collaborate**, choose **Join with invite**, enter a display name, and paste the complete
invite. Editors can change shared authored content; viewers receive live updates without authoring.
The guest's previously open local workspace is snapshotted in memory and restored when they leave
or if authentication fails.

## Authority and data flow

- Scene, asset metadata, Blueprints, FeatherScript, graphs, materials, UI, and other authored project
  data merge through a Yjs CRDT. Reconnecting clients exchange complete state so offline edits merge.
- Project files remain on the host. Assets are fetched directly from the host through authenticated,
  content-hash-verified requests and become temporary guest blob URLs.
- Only the host can Play, save, import packages/assets, or use linked FeatherScript files. This keeps
  simulation and filesystem writes authoritative on one machine.
- Each collaborator has independent selection and scene navigation. Colored avatars mark remote
  selections and transform drags on the matching viewport object and hierarchy row, and mark people
  viewing the same Blueprint or graph node. This presence stays ephemeral and never enters the saved
  project.
- Edit-mode object transforms are projected at roughly 30 Hz while dragging, with the exact pointer-up
  pose flushed immediately. These authored changes travel through the same reconnect-safe CRDT as the
  rest of the project.

## Security and limits

The invite credential is stored in the URL fragment, which browsers do not send while establishing
the ngrok HTTP request. Remote invites must use `https`/`wss`; unencrypted endpoints are accepted
only for the desktop host's loopback relay. Host and guest credentials are separately salted and
hashed by the relay, and role/rate/message-size checks are enforced server-side. Asset downloads
use a separate random capability rotated on every authenticated WebSocket connection; the shared
invite secret is not accepted by the asset endpoint. Transfers are limited to two concurrent and
2 GiB per participant per ten minutes, with an eight-transfer/8 GiB session-wide ceiling, to bound
host load and ngrok bandwidth abuse.

Treat the invite as a bearer secret. Removing a participant disconnects that client, but someone who
still has the shared invite can reconnect as a new client. Stop and start a new session to invalidate
the old link. The host must remain online, there is no Feather-hosted history, and this first version
does not synchronize a running simulation—guests collaborate on authoring while the host controls
Play.
