/** Pages that carry the bar. Forms, tests and videos keep the whole screen
 *  (their own buttons sit at the bottom). */
const WITH_BAR = [/^\/dashboard\/?$/, /^\/mothers\/?$/, /^\/mothers\/\d+\/?$/, /^\/babies\/\d+\/?$/, /^\/tutorials\/?$/, /^\/profile\/?$/, /^\/growth\/?$/];

export const hasBottomNav = (pathname: string) => WITH_BAR.some(re => re.test(pathname));
