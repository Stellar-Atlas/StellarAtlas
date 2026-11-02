import type { HistoryArchiveObjectV1, KnownArchiveRemoteFailureV1 } from 'shared';
import type { RadarHistoryArchiveScanDTO } from '../RadarHistoryArchiveScan.js';
import { projectArchiveVerificationObservations, type ArchiveObservationPolicy } from '../ArchiveVerificationObservations.js';
type Input = Parameters<typeof projectArchiveVerificationObservations>[0];
type Atlas = Extract<Input['atlas'], {status:'loaded'}>['evidence'];
const root='https://history.example.com/History',stamp='2026-01-01T12:00:00Z';
const policy:ArchiveObservationPolicy={state:'configured',now:stamp,maxAgeMs:60000,maxFutureSkewMs:0};
function object(url=root+'/ledger.xdr.gz'):HistoryArchiveObjectV1 {
	return {archiveUrl:root,archiveUrlIdentity:root,objectKey:'ledger/127',objectType:'ledger',objectUrl:url,remoteId:'remote-1',status:'failed',workerStage:null,checkpointLedger:127,bucketHash:null,bytesDownloaded:null,attempts:1,delayReason:null,nextAttemptAt:null,refreshAfter:null,claimedAt:null,updatedAt:stamp,verificationFacts:null,verifiedAt:null,error:{type:'invalid_ledger_hash',message:'Synthetic mismatch',httpStatus:200}};
}
function failure(url=root+'/ledger.xdr.gz'):KnownArchiveRemoteFailureV1 {
	const copies={copies:[],count:null,lookupStatus:'not_requested' as const,sampleLimit:0};
	return {object:object(url),networkVerifiedCopies:copies,sameOrganizationVerifiedCopies:copies,retainedFinding:{observedAt:stamp,failureChannel:'archive_evidence',errorType:'invalid_ledger_hash',errorMessage:'Synthetic mismatch',httpStatus:200}};
}
function atlas(failures:readonly KnownArchiveRemoteFailureV1[]=[]):Atlas {
	const page={filters:{archiveUrlIdentity:root,objectType:null},hasMore:false,limit:10,nextCursor:null,snapshotAt:stamp,total:failures.length};
	return {archiveUrl:root,generatedAt:stamp,remoteFailures:{...page,failures},workerIssues:{...page,issues:[],total:0}};
}
function radar(hasError=true):RadarHistoryArchiveScanDTO {
	return {url:root,startDate:'2026-01-01T11:59:30Z',endDate:stamp,fetchedAt:stamp,endpointUrl:'https://radar.example.invalid/scan',contentHashSha256:'a'.repeat(64),hasError,errorUrl:hasError?root+'/ledger.xdr.gz':null,errorMessage:hasError?'Synthetic report':null,isSlow:false,latestVerifiedLedger:127,sourceId:'withobsrvr-radar'};
}
function project(radarScan=radar(),evidence=atlas(),extra:Partial<Input>={}) {
	return projectArchiveVerificationObservations({requestedRoot:root,radar:{status:'loaded',scan:radarScan},atlas:{status:'loaded',evidence},policy,limit:10,...extra});
}
describe('per-root observed archive reports',()=>{
	it('labels Radar, Atlas and both as observations,never missed-error conclusions',()=>{
		expect(project().reports[0]!.reportedBy).toBe('radar');
		expect(project(radar(false),atlas([failure()])).reports[0]!.reportedBy).toBe('atlas');
		const both=project(radar(),atlas([failure()]));expect(both.reports).toHaveLength(1);expect(both.reports[0]).toMatchObject({reportedBy:'both',conclusion:'observed_reports_only'});
		expect(both.absenceEstablished).toBe(false);expect(both.radar.findingCoverage).toBe('unknown');expect(both.scopeComparison).toBe('unknown_or_unequal');
		expect(project(radar(false)).reports).toEqual([]);
	});
	it('uses existing root normalization without folding case-sensitive paths',()=>{
		expect(project(radar(),atlas(),{requestedRoot:root+'/'}).identityState).toBe('matched');
		expect(project({...radar(),url:root.toLowerCase()}).identityState).toBe('identity_mismatch');
		expect(project({...radar(),url:'https://another.example.com/History'}).reports).toEqual([]);
		expect(project(radar(),{...atlas(),archiveUrl:'https://another.example.com'}).identityState).toBe('identity_mismatch');
	});
	it.each(['not_loaded','not_found','unavailable'] as const)('preserves Radar %s instead of treating it as clean',status=>{
		const value=project(radar(),atlas([failure()]),{radar:{status}});expect(value.radar.status).toBe(status);expect(value.radar.timing).toBeNull();expect(value.absenceEstablished).toBe(false);
	});
	it('separates configured scan age from fresh fetch and unknown/invalid policy',()=>{
		const old={...radar(),startDate:'2025-12-31T00:00:00Z',endDate:'2025-12-31T00:01:00Z',fetchedAt:stamp};
		expect(project(old).radar.timing?.status).toBe('stale');expect(project(old).radar.fetchedAt).toBe(stamp);
		expect(project(old,atlas(),{policy:{state:'unknown'}}).radar.timing?.status).toBe('policy_unknown');
		expect(project(radar(),atlas(),{policy:{state:'configured',now:stamp,maxAgeMs:-1,maxFutureSkewMs:0}}).radar.timing?.status).toBe('invalid_policy');
		expect(project({...radar(),endDate:'2026-01-01T12:00:01Z'}).radar.timing?.status).toBe('future');
		expect(project({...radar(),endDate:'invalid'}).radar.timing?.status).toBe('invalid_timestamp');
		expect(project({...radar(),startDate:'2026-01-02T00:00:00Z'}).radar.windowState).toBe('invalid_window');
	});
	it('never treats a capped page or unequal/unknown checkpoint as complete comparison',()=>{
		const evidence=atlas([failure()]);const capped={...evidence,remoteFailures:{...evidence.remoteFailures,hasMore:true,total:50,nextCursor:'opaque'}};
		const value=project({...radar(),latestVerifiedLedger:63},capped);expect(value.atlas.pageState).toBe('capped');expect(value.radar.checkpointScope).toBe('unknown');expect(value.absenceEstablished).toBe(false);
		const two=atlas([failure(),failure(root+'/other.xdr.gz')]);expect(project(radar(),two,{limit:1}).truncated).toBe(true);
	});
	it('keeps worker/setup counts separate and transport uncertainty explicit',()=>{
		const evidence=atlas();const value=project({...radar(false),errorMessage:'Worker setup failed'},{...evidence,workerIssues:{...evidence.workerIssues,total:1}});
		expect(value.reports).toEqual([]);expect(value.atlas.workerIssueCount).toBe(1);
		const unknown=project({...radar(),errorMessage:'Worker setup failed'});expect(unknown.reports[0]!.radar?.attribution).toBe('unclassified');
		const interrupted=failure();const report={...interrupted,retainedFinding:{...interrupted.retainedFinding!,errorType:'ETIMEDOUT',errorMessage:'Request timed out',httpStatus:null}};
		expect(project(radar(false),atlas([report])).reports[0]!.atlas?.inconclusiveTransport).toBe(true);
	});
	it('rejects foreign/object URL identities and never publishes raw error messages or endpoints',()=>{
		for(const url of ['https://foreign.example/file','https://history.example.com/history/file',root+'/file?token=private',root+'/file#fragment']){
			const value=project({...radar(),errorUrl:url,errorMessage:'not public'});expect(value.reports[0]!.objectUrl).toBeNull();expect(value.invalidObjectIdentity).toBe(true);expect(JSON.stringify(value)).not.toContain('not public');expect(JSON.stringify(value)).not.toContain('radar.example.invalid');
		}
		expect(()=>project(radar(),atlas(),{limit:101})).toThrow(RangeError);
	});
});
