// Browser page translation (Chrome "Translate this page", Google Translate, Edge) swaps React's
// text nodes for its own <font> wrappers. When React later removes or moves one of its original
// nodes, the browser throws "The node to be removed is not a child of this node" and the whole
// page falls back to "This page couldn't load". Trial users read the Dutch app in English this
// way, so a mismatch here must leave the stale node in place instead of crashing the page.
// Workaround from https://github.com/facebook/react/issues/11538.
const removeChild = Node.prototype.removeChild;
Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
  if (child.parentNode !== this) return child;
  return removeChild.call(this, child) as T;
};

const insertBefore = Node.prototype.insertBefore;
Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, child: Node | null): T {
  if (child && child.parentNode !== this) return node;
  return insertBefore.call(this, node, child) as T;
};
