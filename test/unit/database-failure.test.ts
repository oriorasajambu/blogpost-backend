import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseFailure } from '../../src/modules/members/members.repository.js';
import { ApiError } from '../../src/platform/errors/api-error.js';

test('raw SQL and ORM adapter timeouts/deadlocks become safe retryable dependency errors', () => {
  for (const code of ['P2010', 'P2039'])
    for (const state of ['57014', '40P01', '55P03', '53300', '57P01']) {
      const error = {
        code,
        meta: { driverAdapterError: { cause: { originalCode: state } } },
      };
      assert.throws(
        () => databaseFailure(error),
        (failure) => {
          assert.ok(failure instanceof ApiError);
          assert.equal(failure.status, 503);
          assert.equal(failure.code, 'DEPENDENCY_UNAVAILABLE');
          assert.equal(failure.retryAfterSeconds, 1);
          assert.equal(failure.context, null);
          return true;
        },
      );
    }
});
test('SQL syntax and constraint defects are not mislabeled as temporary dependency failures', () => {
  for (const state of ['42601', '23503', '23514', '42P01']) {
    const error = {
      code: 'P2039',
      meta: { driverAdapterError: { cause: { originalCode: state } } },
    };
    assert.throws(
      () => databaseFailure(error),
      (failure) => failure === error,
    );
  }
});
test('unclassified errors are preserved without interpreting their message as a database code', () => {
  const error = new Error('Unrelated error 57014');
  assert.throws(
    () => databaseFailure(error),
    (failure) => failure === error,
  );
});
test('domain denials retain their original status and context', () => {
  const error = new ApiError(
    403,
    'ACCESS_REVOKED',
    'Disabled',
    'Access is unavailable.',
  );
  assert.throws(
    () => databaseFailure(error),
    (failure) => failure === error,
  );
});
