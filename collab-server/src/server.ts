import { Hocuspocus } from '@hocuspocus/server';

const server = new Hocuspocus({
  port: 4000,
  name: 'OpenDraft Collaboration Server',

  async onConnect(data) {
    console.log(`Client connected to document: ${data.documentName}`);
  },

  async onDisconnect(data) {
    console.log(`Client disconnected from document: ${data.documentName}`);
  },

  async onStoreDocument(data) {
    // TODO: Persist Yjs document to PostgreSQL
    console.log(`Document stored: ${data.documentName}`);
  },

  async onLoadDocument(data) {
    // TODO: Load Yjs document from PostgreSQL
    console.log(`Document loaded: ${data.documentName}`);
    return data.document;
  },
});

server.listen();
console.log('OpenDraft Collaboration Server running on port 4000');
