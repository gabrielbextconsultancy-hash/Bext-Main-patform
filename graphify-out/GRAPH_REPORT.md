# Graph Report - bext-automation  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2527 nodes · 4499 edges · 171 communities (131 shown, 40 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 129 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0ad84d1a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168

## God Nodes (most connected - your core abstractions)
1. `createMcpServer()` - 85 edges
2. `toString()` - 64 edges
3. `normalizeParams()` - 59 edges
4. `parse()` - 45 edges
5. `includes()` - 44 edges
6. `"node_modules/ajv/dist/compile/validate/index.js"()` - 35 edges
7. `_addCheck()` - 33 edges
8. `"node_modules/lodash.includes/index.js"()` - 28 edges
9. `getStandardAuthorizeRequestParameters()` - 24 edges
10. `$constructor()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `get()` --indirect_call--> `p()`  [INFERRED]
  vendor/flowagent/mcp.mjs → graph/make-interim-template.js
- `request()` --indirect_call--> `text()`  [INFERRED]
  vendor/flowagent/mcp.mjs → n8n/lib/meeting-card.js
- `validateMapping()` --indirect_call--> `tag()`  [INFERRED]
  vendor/flowagent/mcp.mjs → n8n/lib/ingest.js
- `EngagementProgress` --references--> `Engagement`  [EXTRACTED]
  dashboard/src/lib/queries.ts → dashboard/src/lib/types.ts
- `ReportsPage()` --calls--> `getHealth()`  [EXTRACTED]
  dashboard/src/app/(app)/reports/page.tsx → dashboard/src/lib/queries.ts

## Import Cycles
- None detected.

## Communities (171 total, 40 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (11): RFC-3339, RFC-3986, RFC-4122, RFC-6570, RFC-6819, RFC-6901, RFC-7521, RFC-7523 (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (56): createMsalDiskCachePlugin(), defaultMsalCacheDir(), delay(), isUUID(), "node_modules/ajv/dist/compile/resolve.js"(), countKeys(), getFullPath(), getSchemaRefs() (+48 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (24): addIssueToContext(), assertNever(), datetimeRegex(), floatSafeRemainder2(), _getCached(), getErrorMap(), _getInvalidInput(), getNames() (+16 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (43): buildArchitectureGraph(), determineActor(), DOMAINS, extractTablesFromSql(), extractTrigger(), fs, generateTypeScript(), KNOWN_TABLES (+35 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (25): _cidrv4(), _cidrv6(), _custom(), discriminatedUnion(), _e164(), _emoji2(), _guid(), _ipv4() (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (43): articleAnalysisWorkflow(), CARD_SRC, contentActionsWorkflow(), contentDraftsWorkflow(), contentTopicsWorkflow(), contractTestWorkflow(), dailyNewsCardWorkflow(), dailyReportWorkflow() (+35 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (26): bounds(), CHECKLIST_ORDER, dynamic, fmt(), LANES, metadata, Timeline(), toDate() (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (31): ALLOWED, dynamic, POST(), dynamic, GET(), dynamic, GET(), POST() (+23 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (36): ArchitecturePage(), dynamic, metadata, PLATFORMS, ArchitectureFlowchart(), FLOWS, FlowView, StepCard (+28 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (39): dotenv, dependencies, docxtemplater, pizzip, playwright, description, pizzip, main (+31 more)

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (36): "node_modules/ajv/dist/compile/validate/dataType.js"(), assignParentData(), checkDataType(), checkDataTypes(), coerceAndCheckDataType(), coerceData(), coerceToTypes(), getJSONTypes() (+28 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (37): dependencies, next, pg, react, react-dom, devDependencies, eslint, eslint-config-next (+29 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (34): buildToolContext(), getClient(), rememberEnv(), rememberFlow(), resolveEnv(), resolveFlow(), clear(), clearIf() (+26 more)

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (34): cachedOperationSchema(), cancelAllRuns(), cancelRun(), classicFlowRpRequest(), diagnoseRun(), disableFlow(), followPagination(), getConnector() (+26 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (55): addPattern(), classifyRemediation(), createCacheError(), enhanceFlowApiError(), escapeRegExp(), extractParameters(), _includes(), isCdsPermissionError() (+47 more)

### Community 15 - "Community 15"
Cohesion: 0.10
Nodes (33): fetchText(), fs, only, { parseFeed, parseIndex, normalise }, path, registry, run(), sources (+25 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (30): assertNotManaged(), dataverseDesktopFlowSessionUrl(), dataverseExportSolutionUrl(), dataverseGet(), dataverseImportSolutionUrl(), dataversePatch(), dataversePost(), dataverseSolutionByIdUrl() (+22 more)

### Community 17 - "Community 17"
Cohesion: 0.10
Nodes (24): ContentStatus(), isTransient(), MAP, TONE, act(), CycleWorkspace(), DraftCard(), approve() (+16 more)

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (34): buildAccountToCache(), buildClientInfo(), buildClientInfoFromHomeAccountId(), buildTenantProfile(), checkMaxAge(), containsResourceParam(), createAccessTokenEntity(), createAccountEntity() (+26 more)

### Community 19 - "Community 19"
Cohesion: 0.10
Nodes (22): dynamic, fmtDate(), fmtTime(), groupByDate(), nextRun(), ReportsPage(), revalidate, STATUS (+14 more)

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (8): buildEvent(), commonFields(), detectFromEnv(), getAgentInfo(), getHostInfo(), getSessionId(), getTenantId(), pick2()

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (28): { buildMeetingCard }, DRY, fs, NO_POST, path, PRINT_CARD, retry(), { simpleDocx, vttToBlocks, dedupeVtt } (+20 more)

### Community 22 - "Community 22"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 23 - "Community 23"
Cohesion: 0.10
Nodes (19): dynamic, MeetingsPage(), revalidate, stagesOf(), STATUS, when(), Dir, MeetingsTable() (+11 more)

### Community 24 - "Community 24"
Cohesion: 0.11
Nodes (23): assertNoDuplicateDisplayName(), assertPreviewTokenMatches(), autoMergeConnectionRefs(), copyFlow(), createFlow(), deleteFlow(), editFlow(), enrichRefsWithLogicalNames() (+15 more)

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (28): authenticateConnection(), connectivityRequest(), connQs(), createConnection(), deleteConnection(), fixConnection(), getConnection(), getConnectionPermissions() (+20 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (55): actionType(), add(), addBrokerParameters(), addCorrelationId(), addExtraParameters(), addInstanceAware(), applyFlowEdits(), assertNoOrphanRunAfter() (+47 more)

### Community 27 - "Community 27"
Cohesion: 0.09
Nodes (31): dynamic, GET(), CyclePage(), dynamic, revalidate, ContentPage(), dynamic, revalidate (+23 more)

### Community 28 - "Community 28"
Cohesion: 0.08
Nodes (25): addCcsOid(), addCcsUpn(), addClaims(), addCliData(), addClientCapabilitiesToClaims(), addClientId(), addClientInfo(), addCodeChallengeParams() (+17 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (40): createIdTokenEntity(), createRefreshTokenEntity(), createSha256ContentDigest(), dataverseConnectionReferencesUrl(), dataverseDesktopFlowsUrl(), dataverseFlowSessionsUrl(), dataverseMachineGroupsUrl(), dataverseMachinesUrl() (+32 more)

### Community 30 - "Community 30"
Cohesion: 0.18
Nodes (13): brand(), _catch(), createZodEnum(), _default(), innerType(), keyof(), nullable(), nullish() (+5 more)

### Community 31 - "Community 31"
Cohesion: 0.15
Nodes (20): Deliverables(), dynamic, fmt(), ORDER, daysUntil(), dynamic, formatDue(), ORDER (+12 more)

### Community 32 - "Community 32"
Cohesion: 0.05
Nodes (38): { audit }, chosen, H, ph, { pick }, { plan, backend }, pm, rec (+30 more)

### Community 33 - "Community 33"
Cohesion: 0.11
Nodes (19): _addCheck(), _base64(), _base64url(), cidr(), _cuid(), _cuid2(), date(), duration() (+11 more)

### Community 34 - "Community 34"
Cohesion: 0.17
Nodes (19): { chromium }, getBrowser(), http, MAX_CONCURRENT, NAV_TIMEOUT, PORT, render(), renderDocx() (+11 more)

### Community 35 - "Community 35"
Cohesion: 0.17
Nodes (21): _createRegisteredPrompt(), createToolError(), executeToolHandler(), getLiteralValue(), getMethodValue(), getParseErrorMessage(), isZ4Schema(), mapMiniTarget() (+13 more)

### Community 36 - "Community 36"
Cohesion: 0.06
Nodes (33): appendLocal(), emit(), emitFlowCreated(), emitToolCompleted(), emitToolStarted(), format(), newCorrelationId(), "node_modules/ajv-formats/dist/formats.js"() (+25 more)

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (14): "node_modules/ajv/dist/compile/codegen/code.js"(), addCodeArg(), interpolate(), mergeExprItems(), optimize(), regexpCode(), safeStringify(), str() (+6 more)

### Community 38 - "Community 38"
Cohesion: 0.11
Nodes (20): ago(), dynamic, Health(), metadata, CostBadge(), LivePill(), SetupPill(), getPool() (+12 more)

### Community 39 - "Community 39"
Cohesion: 0.16
Nodes (14): metadata, SLIDES, Box(), Cols(), Deck(), Flow(), Slide, Step() (+6 more)

### Community 40 - "Community 40"
Cohesion: 0.11
Nodes (19): DISABLE_CONSOLE_OUTPUT, FLOWAGENT_TELEMETRY, LOG_LEVEL, MCP_MODE, N8N_API_KEY, N8N_API_URL, PA_CLOUD, PA_DEFAULT_ENVIRONMENT (+11 more)

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (18): abort(), _cleanupTimeout(), _clearTaskQueue(), connect(), $constructor(), defaultCacheDir(), elicitations(), getCapabilities() (+10 more)

### Community 42 - "Community 42"
Cohesion: 0.36
Nodes (9): "node_modules/ajv/dist/vocabularies/core/ref.js"(), callRef(), addErrorsFrom(), addEvaluatedFrom(), callAsyncRef(), callSyncRef(), callRootRef(), callValidate() (+1 more)

### Community 43 - "Community 43"
Cohesion: 0.13
Nodes (20): assertCapabilityForMethod(), assertClientRequestTaskCapability(), assertTaskCapability(), cancelTask(), _cleanupTaskProgressHandler(), createMessageStream(), elicitInput(), elicitInputStream() (+12 more)

### Community 44 - "Community 44"
Cohesion: 0.11
Nodes (4): compile(), "node_modules/ajv/dist/core.js"(), keywordMetaschema(), schemaOrData()

### Community 45 - "Community 45"
Cohesion: 0.05
Nodes (55): _enum(), isInt(), "node_modules/jsonwebtoken/sign.js"(), validate(), validateOptions(), validatePayload(), "node_modules/lodash.includes/index.js"(), arrayLikeKeys() (+47 more)

### Community 46 - "Community 46"
Cohesion: 0.29
Nodes (7): atomicWrite(), cacheKeyFile(), parseJwtClaims(), read(), readEntry(), unkeyedFile(), write()

### Community 47 - "Community 47"
Cohesion: 0.16
Nodes (12): "node_modules/ajv/dist/compile/util.js"(), alwaysValidSchema(), checkStrictMode(), checkUnknownRules(), escapeFragment(), escapeJsonPointer(), evaluatedPropsToName(), getErrorPath() (+4 more)

### Community 48 - "Community 48"
Cohesion: 0.12
Nodes (15): az(), connectionReferences, crypto, definition, DRY, ENV_FILE, { execFileSync }, FLOW_FILE (+7 more)

### Community 49 - "Community 49"
Cohesion: 0.21
Nodes (7): LEAD, NAV, NAV_INDEX, NavEntry, PageHeader(), SidebarToggle(), SideNav()

### Community 50 - "Community 50"
Cohesion: 0.22
Nodes (9): assertNotificationCapability(), assertTaskHandlerCapability(), assertToolsCallTaskCapability(), createElicitationCompletionNotifier(), _enqueueTaskMessage(), notification(), _onrequest(), sendLoggingMessage() (+1 more)

### Community 51 - "Community 51"
Cohesion: 0.17
Nodes (16): decideAdditionalProperties(), parseAnyDef(), parseBrandedDef(), parseDef(), parseDefaultDef(), parseEffectsDef(), parseIntersectionDef(), parseMapDef() (+8 more)

### Community 52 - "Community 52"
Cohesion: 0.13
Nodes (11): BATCH, codeNode, FROM, fs, GAP_MS, path, { Pool }, prompt (+3 more)

### Community 53 - "Community 53"
Cohesion: 0.19
Nodes (13): APPLY, buildMonitor(), crypto, emit(), { io }, main(), monitorList, MONITORS (+5 more)

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (7): create(), discriminator(), exclude(), extract(), options(), optionsMap(), value()

### Community 55 - "Community 55"
Cohesion: 0.26
Nodes (13): "node_modules/ajv/dist/compile/validate/keyword.js"(), addErrs(), checkAsyncKeyword(), funcKeywordCode(), assignValid(), reportErrs(), validateAsync(), validateKeyword() (+5 more)

### Community 56 - "Community 56"
Cohesion: 0.48
Nodes (7): ContentHub(), createCycle(), goPage(), loadArticles(), startAll(), startCycle(), toggle()

### Community 57 - "Community 57"
Cohesion: 0.21
Nodes (12): assertRequestHandlerCapability(), getMethodLiteral(), getObjectShape(), getSchemaDescription(), isOptional(), isSchemaOptional(), parseWithCompat(), promptArgumentsFromSchema() (+4 more)

### Community 58 - "Community 58"
Cohesion: 0.21
Nodes (7): "node_modules/ajv/dist/compile/codegen/index.js"(), addExprNames(), addNames(), mappend(), not(), optimizeExpr(), par()

### Community 59 - "Community 59"
Cohesion: 0.32
Nodes (10): "node_modules/ajv/dist/compile/errors.js"(), addError(), errorInstancePath(), errorObject(), errorObjectCode(), errorSchemaPath(), extraErrorProps(), reportError() (+2 more)

### Community 60 - "Community 60"
Cohesion: 0.26
Nodes (12): "node_modules/ajv/dist/vocabularies/code.js"(), allSchemaProperties(), callValidateCode(), checkMissingProp(), checkReportMissingProp(), hasPropFunc(), isOwnProperty(), noPropertyInData() (+4 more)

### Community 61 - "Community 61"
Cohesion: 0.18
Nodes (10): dependencies, pg, description, pg, main, name, private, scripts (+2 more)

### Community 62 - "Community 62"
Cohesion: 0.20
Nodes (9): fs, graph(), graphToken(), HOSTS, path, QUIET, RECORD, results (+1 more)

### Community 63 - "Community 63"
Cohesion: 0.19
Nodes (13): _createRegisteredTool(), getZodSchemaObject(), isConnected(), issueToolNameWarning(), isZodRawShapeCompat(), isZodSchemaInstance(), isZodTypeLike(), registerTool() (+5 more)

### Community 64 - "Community 64"
Cohesion: 0.47
Nodes (6): addLogToCache(), delete(), issueToken(), markAsRecentlyUsed(), pruneExpired(), redeemToken()

### Community 65 - "Community 65"
Cohesion: 0.27
Nodes (5): BaseHTTPRequestHandler, extract_links(), Handler, Retrieval service for sources that refuse an ordinary HTTP client. Why a second…, Every same-host link with usable anchor text, deduplicated, in page order.

### Community 66 - "Community 66"
Cohesion: 0.12
Nodes (17): dynamic, revalidate, VoicePage(), dynamic, Sources(), STATUS_STYLE, DatabaseDown(), Card() (+9 more)

### Community 67 - "Community 67"
Cohesion: 0.22
Nodes (10): bapDefaultEnvironmentUrl(), getDefaultEnvironment(), getRoutingOperationStatus(), getUserRoutingEnvironment(), governanceBaseUrl(), governanceRoutingStatusUrl(), governanceUserRoutingUrl(), pollRoutingCompletion() (+2 more)

### Community 68 - "Community 68"
Cohesion: 0.24
Nodes (10): en_default(), error(), reportMissingProp(), validateUnion(), "node_modules/ajv/dist/vocabularies/validation/uniqueItems.js"(), canOptimize(), loopN(), loopN2() (+2 more)

### Community 69 - "Community 69"
Cohesion: 0.40
Nodes (5): pruneRetention(), safeMtime(), snapshot(), snapshotOrThrow(), timestampSlug()

### Community 70 - "Community 70"
Cohesion: 0.33
Nodes (6): isNullable(), _parseAsync(), _parseSync(), safeParse(), safeParseAsync(), "~validate"()

### Community 71 - "Community 71"
Cohesion: 0.25
Nodes (7): RFC-5321, b64(), crypto, missing, path, send(), tls

### Community 72 - "Community 72"
Cohesion: 0.22
Nodes (7): APPLY, fs, m, path, { Pool }, PROMPT, WF

### Community 73 - "Community 73"
Cohesion: 0.22
Nodes (9): addFormat(), createDefaultAjvInstance(), emoji(), escapeLiteralCheckValue(), escapeNonAlphaNumeric(), addInitialFormats(), "node_modules/ajv-formats/dist/index.js"(), addFormats() (+1 more)

### Community 74 - "Community 74"
Cohesion: 0.18
Nodes (16): assertCompleteRequestPrompt(), assertCompleteRequestResourceTemplate(), completeCallback(), createCompletionResult(), _createRegisteredResource(), _createRegisteredResourceTemplate(), getCompleter(), handlePromptCompletion() (+8 more)

### Community 75 - "Community 75"
Cohesion: 0.40
Nodes (5): args(), datetime(), rest(), time(), timeSource()

### Community 76 - "Community 76"
Cohesion: 0.28
Nodes (7): "node_modules/ajv/dist/vocabularies/applicator/additionalItems.js"(), validateAdditionalItems(), "node_modules/ajv/dist/vocabularies/applicator/contains.js"(), checkLimits(), validateItems(), validateItemsWithCount(), validateArray()

### Community 77 - "Community 77"
Cohesion: 0.40
Nodes (5): dirty(), mergeArray(), mergeObjectAsync(), mergeObjectSync(), finalizeSet()

### Community 78 - "Community 78"
Cohesion: 0.40
Nodes (5): getDispatcherPath(), getTelemetryConfig(), isOptedOut(), resolveLocalLogPath(), sendToCollector()

### Community 79 - "Community 79"
Cohesion: 0.25
Nodes (4): argIdx, { execFileSync }, missing, path

### Community 80 - "Community 80"
Cohesion: 0.25
Nodes (7): dateIdx, fs, ORDER, outIdx, path, { Pool }, WF

### Community 81 - "Community 81"
Cohesion: 0.46
Nodes (7): buildMeetingEmail(), clip(), esc(), greeting(), isClosed(), longDate(), orgFor()

### Community 82 - "Community 82"
Cohesion: 0.46
Nodes (7): cell_text(), convert_loop_table(), is_header_row(), main(), Writes text into a cell, keeping the first run's formatting. Word splits a…, A row of column labels — 'Project', 'Phase', 'Status' and so on., set_cell_text()

### Community 83 - "Community 83"
Cohesion: 0.14
Nodes (16): adminFlowModifyPermissionsUrl(), adminFlowPermissionsUrl(), adminFlowRestoreUrl(), adminFlowsUrl(), adminFlowUrl(), adminGetFlow(), adminGetFlowPermissions(), adminListFlows() (+8 more)

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (4): getTriggerCallbackUrl(), resolveTriggerName(), runFlow(), runFlowViaCallback()

### Community 85 - "Community 85"
Cohesion: 0.50
Nodes (3): items(), "node_modules/ajv/dist/vocabularies/applicator/items.js"(), validateTuple()

### Community 87 - "Community 87"
Cohesion: 0.33
Nodes (6): RFC-2047, decodeHeader(), FILTER, HOST, run(), tls

### Community 88 - "Community 88"
Cohesion: 0.29
Nodes (5): env, envPath, fs, path, { URLSearchParams }

### Community 89 - "Community 89"
Cohesion: 0.29
Nodes (3): APPLY, https, path

### Community 90 - "Community 90"
Cohesion: 0.33
Nodes (4): esc(), p(), path, PizZip

### Community 91 - "Community 91"
Cohesion: 0.29
Nodes (6): APPLY, fs, ORDER, path, { Pool }, WF

### Community 92 - "Community 92"
Cohesion: 0.33
Nodes (5): argTo, HOST, send(), tls, token()

### Community 93 - "Community 93"
Cohesion: 0.40
Nodes (5): http, json(), { Pool }, PORT, server

### Community 94 - "Community 94"
Cohesion: 0.33
Nodes (5): copies, fs, path, root, standalone

### Community 95 - "Community 95"
Cohesion: 0.33
Nodes (5): { Client }, fs, path, registry, yaml

### Community 96 - "Community 96"
Cohesion: 0.33
Nodes (3): missing, path, tls

### Community 97 - "Community 97"
Cohesion: 0.33
Nodes (3): DRY, FOLDERS, path

### Community 98 - "Community 98"
Cohesion: 0.33
Nodes (3): fs, HTML_FILE, TO

### Community 99 - "Community 99"
Cohesion: 0.33
Nodes (3): missing, path, results

### Community 100 - "Community 100"
Cohesion: 0.33
Nodes (3): LIVE, { Pool }, TIERS

### Community 101 - "Community 101"
Cohesion: 0.33
Nodes (6): aborted(), handleIntersectionResults(), handlePipeResult(), isObject(), isPlainObject(), mergeValues()

### Community 102 - "Community 102"
Cohesion: 0.40
Nodes (6): addErrorMessage(), parseArrayDef(), parseBigintDef(), parseNumberDef(), parseSetDef(), setResponseValueAndErrors()

### Community 103 - "Community 103"
Cohesion: 0.40
Nodes (6): detectAzureCloud(), getCloudEndpoints(), loadConfig(), loadFileConfig(), parseCloudEnvVar(), resolveCloud()

### Community 105 - "Community 105"
Cohesion: 0.40
Nodes (3): fs, origError, path

### Community 106 - "Community 106"
Cohesion: 0.40
Nodes (4): DECKS, fs, path, REPO

### Community 107 - "Community 107"
Cohesion: 0.60
Nodes (4): api2(), APPLY, call(), fixRouting()

### Community 108 - "Community 108"
Cohesion: 0.50
Nodes (4): LIMIT, lookup(), pickDate(), { Pool }

### Community 109 - "Community 109"
Cohesion: 0.50
Nodes (4): LIMIT, lookup(), pick(), { Pool }

### Community 110 - "Community 110"
Cohesion: 0.40
Nodes (3): createTelemetryObserver(), clientName(), setMcpClient()

### Community 113 - "Community 113"
Cohesion: 0.40
Nodes (5): _normalize(), _overwrite(), _toLowerCase(), _toUpperCase(), _trim()

### Community 114 - "Community 114"
Cohesion: 0.50
Nodes (3): HOSTS, missing, path

### Community 115 - "Community 115"
Cohesion: 0.22
Nodes (8): check(), cleanParams(), custom2(), handleRefineResult(), issue(), message(), _refine(), superRefine()

### Community 116 - "Community 116"
Cohesion: 0.50
Nodes (4): config(), finalizeIssue(), handleUnionResults(), unwrapMessage()

### Community 117 - "Community 117"
Cohesion: 0.50
Nodes (4): getAliasesFromMetadata(), getAliasesFromStaticSources(), getCloudDiscoveryMetadataFromHardcodedValues(), getCloudDiscoveryMetadataFromNetworkResponse()

### Community 118 - "Community 118"
Cohesion: 0.50
Nodes (4): handleArrayResult(), handleObjectResult(), handleOptionalObjectResult(), prefixIssues()

### Community 119 - "Community 119"
Cohesion: 0.50
Nodes (4): isAccessTokenEntity(), isCredentialEntity(), isIdTokenEntity(), isRefreshTokenEntity()

### Community 120 - "Community 120"
Cohesion: 0.83
Nodes (4): "node_modules/ajv/dist/compile/validate/applicability.js"(), schemaHasRulesForType(), shouldUseGroup(), shouldUseRule()

### Community 121 - "Community 121"
Cohesion: 0.83
Nodes (4): "node_modules/ajv/dist/compile/validate/boolSchema.js"(), boolOrEmptySchema(), falseSchemaError(), topBoolOrEmptySchema()

### Community 125 - "Community 125"
Cohesion: 0.83
Nodes (4): "node_modules/ajv-formats/dist/limit.js"(), compareCode(), validate$DataFormat(), validateFormat()

### Community 130 - "Community 130"
Cohesion: 0.67
Nodes (3): buildCompositeAuth(), getMsalAuth(), getAzTenantId()

### Community 131 - "Community 131"
Cohesion: 0.67
Nodes (3): deepPartial(), deepPartialify(), unwrap()

### Community 133 - "Community 133"
Cohesion: 0.67
Nodes (3): isPlainObject3(), mergeCapabilities(), registerCapabilities()

### Community 134 - "Community 134"
Cohesion: 1.00
Nodes (3): "node_modules/ajv/dist/compile/validate/defaults.js"(), assignDefault(), assignDefaults()

## Knowledge Gaps
- **411 isolated node(s):** `Actor`, `Row`, `Dir`, `SortKey`, `StageFlag` (+406 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **40 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `"node_modules/ajv/dist/compile/resolve.js"()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `"node_modules/ajv/dist/core.js"()` connect `Community 44` to `Community 0`, `Community 73`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `validateMapping()` connect `Community 15` to `Community 68`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `parse()` (e.g. with `discriminator()` and `items()`) actually correct?**
  _`parse()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Actor`, `Row`, `Dir` to the rest of the system?**
  _411 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.005479452054794521 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.054563492063492064 - nodes in this community are weakly interconnected._