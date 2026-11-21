// Content is visible by default. Only add the entrance effect as it crosses the viewport.
export class ScrollReveals {
  #observer;
  #seen = new WeakSet();

  constructor(signal) {
    if (!('IntersectionObserver' in window)) return;
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    this.#observer = new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        this.#observer.unobserve(target);
        this.#seen.add(target);
        if (motion.matches && !target.matches(':focus-within')) {
          target.classList.add('scroll-enter');
        }
      }
    });

    const finish = event => {
      if (event.animationName.startsWith('scroll-reveal-')) {
        event.target.classList.remove('scroll-enter');
      }
    };
    document.addEventListener('animationend', finish, { signal });
    document.addEventListener('animationcancel', finish, { signal });
    signal.addEventListener('abort', () => this.#observer.disconnect(), { once: true });
  }

  refresh() {
    if (!this.#observer) return;
    // The catalog replaces card nodes on category changes. Drop detached targets first.
    this.#observer.disconnect();
    for (const element of document.querySelectorAll('main [data-reveal]')) {
      if (!this.#seen.has(element)) this.#observer.observe(element);
    }
  }
}
