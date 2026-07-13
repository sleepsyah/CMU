// Adapted from React Bits Count Up (David Haz), MIT + Commons Clause.
// https://www.reactbits.dev/text-animations/count-up
import { useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useCallback, useEffect, useRef } from "react";

export default function CountUp({
  to,
  from = 0,
  duration = 0.32,
  suffix = "",
  className = ""
}: {
  to: number;
  from?: number;
  duration?: number;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(from);
  const springValue = useSpring(motionValue, {
    damping: 32,
    stiffness: 240 / duration
  });
  const format = useCallback((value: number) => `${Math.round(value)}${suffix}`, [suffix]);

  useEffect(() => {
    if (ref.current) ref.current.textContent = format(reduceMotion ? to : from);
  }, [format, from, reduceMotion, to]);

  useEffect(() => springValue.on("change", (value) => {
    if (ref.current) ref.current.textContent = format(value);
  }), [format, springValue]);

  useEffect(() => {
    if (reduceMotion) {
      motionValue.set(to);
      if (ref.current) ref.current.textContent = format(to);
      return;
    }
    const frame = window.requestAnimationFrame(() => motionValue.set(to));
    return () => window.cancelAnimationFrame(frame);
  }, [format, motionValue, reduceMotion, to]);

  return <span className={className} ref={ref}>{format(reduceMotion ? to : from)}</span>;
}
