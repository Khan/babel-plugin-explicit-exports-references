import { NodePath, PluginObj, PluginPass } from '@babel/core';
import debugFactory from 'debug';
import * as util from '@babel/types';
import template from '@babel/template';

const pkgName = 'babel-plugin-explicit-exports-references';
const debug = debugFactory(`${pkgName}:index`);
let globalScope: NodePath['scope'];

function updateExportReferences(
  path: NodePath<util.Identifier>,
  mode: 'named' | 'default',
  transformAssignExpr: boolean
): void;
function updateExportReferences(
  path: { from: NodePath<util.Identifier>; to: string },
  mode: 'named' | 'default',
  transformAssignExpr: boolean
): void;
function updateExportReferences(
  path: NodePath<util.Identifier> | { from: NodePath<util.Identifier>; to: string },
  mode: 'named' | 'default',
  transformAssignExpr: boolean
): void {
  // @ts-expect-error: need to discriminate between input types
  const idPath = (path.isIdentifier?.() ? path : path.from) as NodePath<util.Identifier>;
  const localName = idPath.node.name;
  // @ts-expect-error: need to discriminate between input types
  const exportedName = (path.to as string) || localName;
  const globalBinding = globalScope.getBinding(localName);
  const referencePaths = [
    ...(globalBinding?.referencePaths || []),
    ...(globalBinding?.constantViolations || [])
  ];

  const numberReferences = referencePaths?.length || 0;
  const dbg = debug.extend(`mode-${mode}:updating`);

  if (numberReferences) {
    dbg(
      `potentially updating ${numberReferences} references to ${mode} export "${localName}"` +
        (exportedName != localName ? ` (exported as "${exportedName}")` : '')
    );
  } else dbg('no references to update');

  referencePaths?.forEach((referencePath, ndx) => {
    const prefix = `ref-${exportedName}-${(ndx + 1).toString()}`;

    if (
      // eslint-disable-next-line unicorn/prefer-array-some
      !!referencePath.find(
        (path) =>
          path.isExportSpecifier() ||
          path.isExportNamespaceSpecifier() ||
          path.isExportDefaultSpecifier()
      )
    ) {
      dbg(`[${prefix}] reference skipped: part of an export specifier`);
      return;
    }

    // eslint-disable-next-line unicorn/prefer-array-some
    if (!!referencePath.find((path) => path.isTSType())) {
      dbg(`[${prefix}] reference skipped: TypeScript type reference`);
      return;
    }

    if (
      referencePath.isJSXIdentifier() ||
      referencePath.parentPath?.isJSXOpeningElement()
    ) {
      dbg(`[${prefix}] transforming type "JSX identifier"`);
      const jsxElement = template.expression.ast(
        `<module.exports.${mode == 'default' ? mode : exportedName} />`,
        { plugins: ['jsx'] }
      ) as util.JSXElement;
      const jsxMemberExpression = jsxElement.openingElement.name;
      referencePath.replaceWith(jsxMemberExpression);
    } else if (referencePath.isIdentifier()) {
      dbg(`[${prefix}] transforming type "identifier"`);
      referencePath.replaceWith(
        template.expression.ast`module.exports.${mode == 'default' ? mode : exportedName}`
      );
    } else if (transformAssignExpr && referencePath.isAssignmentExpression()) {
      dbg(`[${prefix}] transforming type "assignment expression"`);
      referencePath
        .get('left')
        // TODO: needs to be more resilient, but we'll repeat this here for now
        .replaceWith(
          template.expression.ast`module.exports.${
            mode == 'default' ? mode : exportedName
          }`
        );
    } else dbg(`[${prefix}] reference skipped: unsupported type "${referencePath.type}"`);
  });
}

export default function (): PluginObj<
  PluginPass & { opts: { transformAssignExpr: boolean } }
> {
  return {
    name: 'explicit-exports-references',
    visitor: {
      Program(programPath) {
        globalScope = programPath.scope;
      },
      ExportDefaultDeclaration(exportPath, state) {
        const declaration = exportPath.get('declaration');
        const transformAssignExpr = state.opts.transformAssignExpr;
        const dbg = debug.extend('mode-default');

        debug(`encountered default export declaration`);

        if (declaration.isFunctionDeclaration() || declaration.isClassDeclaration()) {
          const id = declaration.get('id') as NodePath<util.Identifier>;
          if (id?.node?.name) updateExportReferences(id, 'default', transformAssignExpr);
          else dbg('default declaration is anonymous, ignored');
        } else dbg('default declaration not function or class, ignored');
      },
      ExportNamedDeclaration(exportPath, state) {
        const declaration = exportPath.get('declaration');
        const specifiers = exportPath.get('specifiers');
        const transformAssignExpr = state.opts.transformAssignExpr;
        const dbg = debug.extend('mode-named');

        if (!declaration.node && !specifiers.length) {
          dbg('ignored empty named export declaration');
          return;
        }

        debug(`encountered named export node`);
        dbg(`processing declaration`);

        if (declaration.node) {
          if (declaration.isFunctionDeclaration() || declaration.isClassDeclaration()) {
            updateExportReferences(
              declaration.get('id') as NodePath<util.Identifier>,
              'named',
              transformAssignExpr
            );
          } else if (declaration.isVariableDeclaration()) {
            declaration.get('declarations').forEach((declarator) => {
              const id = declarator.get('id');
              if (id.isIdentifier())
                updateExportReferences(id, 'named', transformAssignExpr);
              else if (id.isObjectPattern()) {
                id.get('properties').forEach((propertyPath) => {
                  if (propertyPath.isObjectProperty()) {
                    const propertyId = propertyPath.get('value');
                    if (propertyId.isIdentifier())
                      updateExportReferences(propertyId, 'named', transformAssignExpr);
                  } else if (propertyPath.isRestElement()) {
                    const argument = propertyPath.get('argument');
                    if (argument.isIdentifier())
                      updateExportReferences(argument, 'named', transformAssignExpr);
                  }
                });
              }
            });
          } else {
            dbg(
              'named declaration is not a function, class, or variable declaration; ignored'
            );
          }
        }

        specifiers.length && dbg(`processing ${specifiers.length} specifiers`);

        // ? Later exports take precedence over earlier ones
        specifiers.forEach((specifier) => {
          if (!specifier.isExportSpecifier()) {
            dbg(`ignored export specifier type "${specifier.type}"`);
          } else {
            const local = specifier.get('local');
            const exported = specifier.get('exported');

            dbg(`encountered specifier "${local} as ${exported}"`);

            if (exported.isIdentifier()) {
              const exportedName = exported.node.name;
              updateExportReferences(
                {
                  from: local,
                  to: exportedName
                },
                exportedName == 'default' ? 'default' : 'named',
                transformAssignExpr
              );
            } else {
              dbg(
                'ignored export specifier because module string names are not supported'
              );
            }
          }
        });
      }
    }
  };
}
