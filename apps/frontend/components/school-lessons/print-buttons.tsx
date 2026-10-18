'use client';

import { Printer } from 'lucide-react';
import { buttonClass } from '@/lib/ui-classes';

/**
 * Two print versions of one lesson. The student copy is the default
 * (also for Ctrl+P): teacher-only blocks are hidden by the print CSS in
 * globals.css. The teacher copy flags <html> and opens the collapsed
 * answers for the duration of the print dialog, then puts them back.
 */
export function LessonPrintButtons({ student, teacher }: { student: string; teacher: string }) {
  function print(withAnswers: boolean) {
    const root = document.documentElement;
    const opened: HTMLDetailsElement[] = [];
    if (withAnswers) {
      root.dataset.printAnswers = '';
      document.querySelectorAll<HTMLDetailsElement>('details.teacher-only').forEach((d) => {
        if (!d.open) {
          d.open = true;
          opened.push(d);
        }
      });
    }
    const restore = () => {
      delete root.dataset.printAnswers;
      opened.forEach((d) => (d.open = false));
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button type="button" onClick={() => print(false)} className={buttonClass.secondary}>
        <Printer className="h-4 w-4" aria-hidden="true" />
        {student}
      </button>
      <button type="button" onClick={() => print(true)} className={buttonClass.secondary}>
        <Printer className="h-4 w-4" aria-hidden="true" />
        {teacher}
      </button>
    </div>
  );
}
