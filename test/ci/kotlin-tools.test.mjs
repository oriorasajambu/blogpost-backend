import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { configuredGradleHome } from '../../scripts/kotlin-tools.mjs';

test('ambient hosted-runner Gradle cannot override the pinned consumer toolchain', () => {
  assert.equal(
    configuredGradleHome({ GRADLE_HOME: '/runner/gradle-9.8.1' }),
    null,
  );
  assert.equal(
    configuredGradleHome({
      BLOGPOST_GRADLE_HOME: '.local/explicit-gradle',
      GRADLE_HOME: '/runner/gradle-9.8.1',
    }),
    resolve('.local/explicit-gradle'),
  );
});
