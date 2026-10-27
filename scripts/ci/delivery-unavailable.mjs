// Deliberate closed gate while cloud/release/evidence implementation is incomplete.
// No credential is requested and no publication or deployment is attempted here.
console.error(
  'Delivery and promotion remain unavailable: trusted staging/manual receipts, real environment profiles, immutable release publication and guarded recovery are not implemented and verified. See docs/IMPLEMENTATION_STATUS.md.',
);
process.exitCode = 1;
