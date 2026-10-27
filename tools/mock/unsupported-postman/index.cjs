// Prism's shared parser eagerly imports Postman even for OpenAPI documents.
// This toolchain supports only the checked-in OpenAPI contract. Do not install
// the unused Postman SDK and its obsolete dynamic-value generator dependency.
class UnsupportedPostmanCollection {
  constructor() {
    throw new Error(
      'Postman collections are disabled in the Blogpost OpenAPI-only proxy.',
    );
  }
}
module.exports = Object.freeze({ Collection: UnsupportedPostmanCollection });
