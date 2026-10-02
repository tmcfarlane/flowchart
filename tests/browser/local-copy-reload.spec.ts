import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { LocalCopyFixture } from './local-copy-fixture'

async function runProof(page: Page, testInfo: TestInfo, scenario: (fixture: LocalCopyFixture) => Promise<void>) {
  const fixture = new LocalCopyFixture(page, testInfo)
  try {
    await fixture.startAndCopy()
    await scenario(fixture)
    await fixture.finish()
  } catch (error) {
    fixture.failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    try { await fixture.completeNativeObservers() }
    finally { await fixture.attachReceipt() }
  }
}

test('an editable shared copy survives full reload, explicit Restore, and another inline edit', async ({ page }, testInfo) => {
  await runProof(page, testInfo, async fixture => {
    fixture.mark('edit-copy-and-naturally-save')
    const firstLabel = 'Copied API · before reload'
    await fixture.editLabel(firstLabel)
    const saved = await fixture.waitForSaved(firstLabel)
    await fixture.assertNativeExport('edited-copy', firstLabel)
    await fixture.observeNoPolling('detached-two-poll-windows')
    expect(await fixture.readRaw()).toBe(saved.raw)

    const navigation = await fixture.reloadForRecovery(saved.raw)
    // The draft remains a reviewable backup until the user explicitly applies it.
    await fixture.restore(firstLabel)
    expect(await fixture.readRaw()).toBe(saved.raw)
    await fixture.assertNativeExport('restored-before-next-edit', firstLabel)

    fixture.mark('edit-restored-copy-and-naturally-save')
    const secondLabel = 'Restored API · edited again'
    await fixture.editLabel(secondLabel)
    const edited = await fixture.waitForSaved(secondLabel)
    expect(edited.draft.savedAt).toBeGreaterThanOrEqual(saved.draft.savedAt)
    await fixture.assertNativeExport('restored-edited', secondLabel)
    await fixture.observeNoPolling('restored-two-poll-windows')
    expect(await fixture.readRaw()).toBe(edited.raw)
    fixture.details.recovery = { navigation, oldBytesSurvivedReloadBeforeExplicitRestore: true, originalSavedAt: saved.draft.savedAt, originalSha256: saved.sha256, finalSavedAt: edited.draft.savedAt, finalSha256: edited.sha256, fullGraphMatchedBeforeAndAfterSecondEdit: true }
  })
})

test('native reload before pending autosave preserves the latest committed copy edit', async ({ page }, testInfo) => {
  await runProof(page, testInfo, async fixture => {
    fixture.mark('naturally-save-baseline')
    const baseline = await fixture.waitForSaved('Source API')
    await fixture.observeNoPolling('detached-two-poll-windows')
    expect(await fixture.readRaw()).toBe(baseline.raw)
    await fixture.installNativeObservers()

    fixture.mark('native-inline-edit-pending-autosave')
    const latestLabel = 'Early reload API · latest edit'
    await fixture.apiLabel().dblclick()
    const input = page.locator('.react-flow-wrapper [data-id="api"] input.node-input')
    await input.fill(latestLabel)
    const enterPressStartedAtMs = Date.now()
    await input.press('Enter')
    const enterPressCompletedAtMs = Date.now()
    // Read immediately, without retrying until the debounce expires.
    const pending = await fixture.readPreReload()
    expect(pending.visibleLabel).toBe(latestLabel)
    expect(pending.inputCount).toBe(0)
    expect(pending.raw, 'The naturally saved bytes must still be old when native reload begins').toBe(baseline.raw)
    expect(pending.commit).not.toBeNull()
    const commit = pending.commit!
    expect(commit.isTrusted).toBe(true)
    expect(commit.key).toBe('Enter')
    expect(commit.value).toBe(latestLabel)

    fixture.mark('native-reload-before-pending-autosave')
    const reloadCallAtMs = Date.now()
    await page.reload({ waitUntil: 'load' })
    await fixture.completeNativeObservers()
    const reloadRequest = fixture.documents.find(request => request.phase === 'native-reload-before-pending-autosave')
    expect(reloadRequest).toBeTruthy()
    const commitToReloadRequestMs = reloadRequest!.epochMs - commit.eventEpochMs
    expect(commitToReloadRequestMs).toBeGreaterThanOrEqual(0)
    expect(commitToReloadRequestMs, 'This must exercise unload before the actual autosave delay').toBeLessThan(fixture.debounceMs)
    const newTimeOrigin = await page.evaluate(() => performance.timeOrigin)
    expect(newTimeOrigin).toBeGreaterThan(pending.timeOrigin)
    expect(page.url()).toBe(fixture.origin + '/')
    await fixture.expectRecovery()

    const raw = await fixture.readRaw()
    expect(raw).not.toBeNull()
    const recovered = fixture.assertDraft(raw!, latestLabel)
    expect(recovered.raw).not.toBe(baseline.raw)
    const commitToActualSaveMs = recovered.draft.savedAt - commit.eventEpochMs
    expect(commitToActualSaveMs).toBeGreaterThanOrEqual(0)
    expect(commitToActualSaveMs).toBeLessThan(fixture.debounceMs)
    const naturalPagehide = fixture.lifecycle.find(event => event.kind === 'pagehide' && event.isTrusted && event.timeOrigin === pending.timeOrigin)
    expect(naturalPagehide, 'Observe a trusted browser lifecycle event rather than dispatching one').toBeTruthy()
    expect(naturalPagehide!.savedApiLabel).toBe(latestLabel)

    await fixture.restore(latestLabel)
    await fixture.assertNativeExport('latest-edit-restored', latestLabel)
    await fixture.observeNoPolling('restored-two-poll-windows')
    expect(await fixture.readRaw()).toBe(recovered.raw)
    fixture.details.earlyUnload = {
      baseline: { label: 'Source API', savedAt: baseline.draft.savedAt, sha256: baseline.sha256, naturallySaved: true },
      enterPressStartedAtMs, enterPressCompletedAtMs, trustedEnter: commit,
      committedVisibleLabel: pending.visibleLabel, editingInputGone: pending.inputCount === 0,
      preReloadStorageReadAtMs: pending.observedAtMs, preReloadBytesExactlyEqualBaseline: pending.raw === baseline.raw,
      reloadCallAtMs, reloadRequest, commitToReloadRequestMs, commitToActualSaveMs,
      oldTimeOrigin: pending.timeOrigin, newTimeOrigin,
      restoredSavedAt: recovered.draft.savedAt, restoredSha256: recovered.sha256,
      explicitPreviewThenRestore: true, fullGraphAndLatestEditRecovered: true,
      artificialLifecycleEventsOrFlushCalls: false, harnessStorageWritesOrSeeds: false, appTimersOverridden: false,
    }
  })
})
