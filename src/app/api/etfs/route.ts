import { NextResponse } from 'next/server';
import * as ftp from 'basic-ftp';
import { Writable } from 'stream';

export const revalidate = 86400; // 1 day

export async function GET() {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: "ftp.nasdaqtrader.com",
    });

    let fileContent = '';
    const writable = new Writable({
      write(chunk, encoding, callback) {
        fileContent += chunk.toString();
        callback();
      }
    });

    await client.downloadTo(writable, "symboldirectory/nasdaqtraded.txt");

    const lines = fileContent.split('\n');
    const etfTickers: string[] = [];

    // Skip header (index 0)
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('|');
      // parts[1] is Symbol, parts[5] is ETF (Y/N/ )
      if (parts.length > 5 && parts[5] === 'Y') {
        etfTickers.push(parts[1]);
      }
    }

    return NextResponse.json({ success: true, count: etfTickers.length, data: etfTickers });
  } catch (err: any) {
    console.error("FTP Error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    client.close();
  }
}
