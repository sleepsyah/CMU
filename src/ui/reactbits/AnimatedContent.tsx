// Reduced-motion-safe adaptation of React Bits Animated Content (David Haz),
// MIT + Commons Clause. https://www.reactbits.dev/animations/animated-content
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export default function AnimatedContent({
  children,
  className = "",
  delay = 0,
  distance = 8
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: distance }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.26, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
