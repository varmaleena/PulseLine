import { z } from 'zod';
export const speaker = z.enum(['doctor','patient']);
export type Speaker = z.infer<typeof speaker>;
export type Urgency = 'normal'|'elevated'|'high';
export const patientSchema=z.object({
 name:z.string().trim().min(2).max(120),patientId:z.string().trim().min(2).max(80),age:z.string().trim().max(20),gender:z.string().trim().max(40),phone:z.string().trim().max(40).optional().default(''),emergencyContact:z.string().trim().max(120).optional().default(''),allergies:z.string().trim().max(500).optional().default(''),conditions:z.string().trim().max(1000).optional().default(''),currentMedications:z.string().trim().max(1000).optional().default(''),reasonForVisit:z.string().trim().min(2).max(1000),department:z.string().trim().min(2).max(120),room:z.string().trim().max(40).optional().default(''),consent:z.literal(true)
});
export type Patient= z.infer<typeof patientSchema>;
export const messageSchema = z.discriminatedUnion('type',[
 z.object({type:z.literal('session_start'),doctorLanguage:z.literal('en'),patientLanguage:z.enum(['hi','te']),mode:z.enum(['demo','live']).default('demo'),patient:patientSchema,pin:z.string().max(128).optional()}),
 z.object({type:z.literal('audio_chunk'),mic:speaker,seq:z.number().int().nonnegative(),data:z.string().min(4).max(22000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)}),
 z.object({type:z.literal('audio_end'),mic:speaker}),
 z.object({type:z.literal('flag_urgent'),speaker,urgency:z.enum(['normal','elevated','high'])}),
 z.object({type:z.literal('demo_turn'),index:z.number().int().min(0).max(3)}),
 z.object({type:z.literal('session_end')})
]);
export type ClientMessage = z.infer<typeof messageSchema>;
export interface Turn {id:string;speaker:Speaker;original_text:string;translated_text:string;urgency:Urgency;timestamp:string;interrupt:boolean;latency_ms:number;provisional?:boolean}
export interface ClinicalItem {id:string;category:'symptom'|'history'|'attention'|'medication'|'investigation'|'procedure'|'followup'|'instruction';text:string;sourceTurnId:string;sourceText:string;status:'unconfirmed'|'confirmed'|'dismissed';speaker:Speaker}
export interface ClinicalSummary {chiefComplaint:string;patientHighlights:ClinicalItem[];doctorPlan:ClinicalItem[];attentionItems:ClinicalItem[];unresolved:string[];reviewed:boolean;reviewedBy?:string;reviewedAt?:string}
export const phrases = {
 hi:[['doctor','Can you tell me where it hurts?','क्या आप बता सकते हैं कि दर्द कहाँ हो रहा है?'],['patient','मेरे सीने में दर्द हो रहा है।','I have pain in my chest.'],['doctor','When did the pain start?','दर्द कब शुरू हुआ?'],['patient','मुझे साँस लेने में बहुत तकलीफ़ हो रही है।','I am having a lot of difficulty breathing.']],
 te:[['doctor','Can you tell me where it hurts?','ఎక్కడ నొప్పిగా ఉందో చెప్పగలరా?'],['patient','నా ఛాతీలో నొప్పిగా ఉంది.','I have pain in my chest.'],['doctor','When did the pain start?','నొప్పి ఎప్పుడు మొదలైంది?'],['patient','నాకు ఊపిరి తీసుకోవడం చాలా కష్టంగా ఉంది.','I am having a lot of difficulty breathing.']]
} as const;
export function rms(pcm:Buffer){let sum=0;for(let i=0;i+1<pcm.length;i+=2)sum+=(pcm.readInt16LE(i)/32768)**2;return Math.sqrt(sum/Math.max(1,pcm.length/2));}
