import { Suspense } from "react";
import { Console } from "@/components/console/console";

export default function ConsolePage() {
  return (
    <Suspense>
      <Console />
    </Suspense>
  );
}
