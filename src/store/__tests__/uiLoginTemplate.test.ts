import { describe, expect, it } from 'vitest';
import { findUIElement, makeUITemplate } from '../editor/ui';
import type { UIElement } from '../../types';

describe('login UI template', () => {
  it('builds a screen with username/password inputs and login events', () => {
    const { doc, vars } = makeUITemplate('login');
    expect(doc.name).toBe('Login Screen');
    expect(doc.surface).toBe('screen');
    expect(doc.visibleOnStart).toBe(true);

    const username = findUIElement(doc.root, findByName(doc.root, 'Username')!);
    const password = findUIElement(doc.root, findByName(doc.root, 'Password')!);
    const signIn = findUIElement(doc.root, findByName(doc.root, 'Sign In')!);
    const guest = findUIElement(doc.root, findByName(doc.root, 'Guest')!);
    const error = findUIElement(doc.root, findByName(doc.root, 'Error')!);

    expect(username?.kind).toBe('input');
    expect(username?.valueVariable).toBe('username');
    expect(password?.kind).toBe('input');
    expect(password?.valueVariable).toBe('password');
    expect(signIn?.onClickEvent).toBe('loginPressed');
    expect(guest?.onClickEvent).toBe('loginAsGuest');
    expect(error?.bindings.some((b) => b.target === 'visible' && b.expression.includes('loginError'))).toBe(true);

    expect(vars.map((v) => v.name).sort()).toEqual(['isLoggedIn', 'loginError', 'password', 'username'].sort());
  });
});

function findByName(root: UIElement, name: string): string | undefined {
  if (root.name === name) return root.id;
  for (const child of root.children) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return undefined;
}
