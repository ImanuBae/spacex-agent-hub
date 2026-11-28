"use client";

import { StudentState } from "./StudentStates";

export default function StudentError({ reset }: { reset: () => void }) {
  return <StudentState state="500" retry={reset} />;
}
