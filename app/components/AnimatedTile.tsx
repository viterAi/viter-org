"use client";

import { motion } from "framer-motion";

export function AnimatedTile({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay }}
    >
      {children}
    </motion.div>
  );
}
