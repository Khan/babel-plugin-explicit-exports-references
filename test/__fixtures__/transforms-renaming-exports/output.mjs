const var1 = 5;
const var2 = module.exports.var1 + 6;
const var3 = module.exports.var1 + var2;

export { var1 as v1, var3 as v3 };
