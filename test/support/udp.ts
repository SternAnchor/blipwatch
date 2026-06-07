import { createSocket } from "node:dgram";

export const sendUdpPacket = async (port: number, data: Buffer): Promise<void> => {
  const client = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      client.send(data, port, "127.0.0.1", (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  } finally {
    client.close();
  }
};
