"use client";

import { useState } from "react";
import { CHANNEL_DOMAINS } from "../utils";

export function SourceIcon({
  name,
  keyStr,
  domain: domainOverride,
}: {
  name: string;
  keyStr: string;
  domain?: string;
}) {
  const [imgOk, setImgOk] = useState<boolean | null>(null);
  const domain = domainOverride ?? keyStr.replace(/_/g, "").replace(/\s+/g, "").toLowerCase() + ".com";
  const src = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const letter = (name[0] ?? "?").toUpperCase();

  return (
    <span style={{ position: "relative", width: 18, height: 18, flexShrink: 0, display: "inline-flex" }}>
      <span
        style={{
          position: "absolute", inset: 0,
          borderRadius: 4,
          background: `hsl(${hue}, 52%, 62%)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 700, color: "white",
          opacity: imgOk === true ? 0 : 1,
          transition: "opacity 0.2s",
        }}
      >
        {letter}
      </span>
      <img
        src={src}
        alt=""
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          borderRadius: 3,
          objectFit: "contain",
          opacity: imgOk === true ? 1 : 0,
          transition: "opacity 0.25s",
        }}
        onLoad={() => setImgOk(true)}
        onError={() => setImgOk(false)}
      />
    </span>
  );
}

export { CHANNEL_DOMAINS };
