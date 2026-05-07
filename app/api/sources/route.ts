import { NextResponse } from "next/server";
import { getMockChats } from "../../../lib/l0/mock-data";

export async function GET() {
  return NextResponse.json({ sources: getMockChats() });
}
