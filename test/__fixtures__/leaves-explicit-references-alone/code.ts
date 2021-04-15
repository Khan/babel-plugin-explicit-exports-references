function internalfn1() {
  module.exports.fn1();
  void Promise.all(
    [1, 2, 3].map((_) => [module.exports.fn2]).map((a) => a[0]())
  );
}

export function fn1() {
  global.console.log('hello, world!');
}

export async function fn2() {
  module.exports.fn1();
  internalfn1();
}

export async function fn3() {
  const f = module.exports.fn1;
  await fn2(); // ! XXX
  f();
  internalfn1();
}

internalfn1();
void module.exports.fn3();
