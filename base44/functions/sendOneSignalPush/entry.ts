import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    console.log('[sendOneSignalPush] ========== FUNCTION START ==========');
    
    try {
        const bodyText = await req.text();
        let payload;
        try {
            payload = JSON.parse(bodyText);
        } catch (parseError) {
            return Response.json({ success: false, error: 'Invalid JSON in request body', details: parseError.message }, { status: 400 });
        }

        const appId = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
        const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

        if (!appId || !restApiKey) {
            return Response.json({ success: false, error: 'Missing OneSignal environment variables.' }, { status: 500 });
        }

        const { userEmail, title, message, sendAtISO, minutesFromNow, data, android_channel_id, buttons } = payload;
        
        if (!userEmail) {
            return Response.json({ success: false, error: 'userEmail is required' }, { status: 400 });
        }

        if (!title || !message) {
            return Response.json({ success: false, error: 'Missing title or message body' }, { status: 400 });
        }

        const notificationPayload: any = {
            app_id: appId,
            include_external_user_ids: [String(userEmail)],
            headings: { en: title },
            contents: { en: message },
            data: data || {},
            channel_for_external_user_ids: "push",
            ...(sendAtISO && { send_after: sendAtISO }),
            ...((minutesFromNow !== undefined && !sendAtISO) && {
                send_after: new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString()
            }),
            ...(buttons && buttons.length > 0 && { buttons: buttons }),
        };
        
        if (android_channel_id) {
            notificationPayload.android_channel_id = android_channel_id;
        }

        console.log('[sendOneSignalPush] Sending payload:', JSON.stringify(notificationPayload, null, 2));

        const oneSignalResponse = await fetch("https://onesignal.com/api/v1/notifications", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${restApiKey}`
            },
            body: JSON.stringify(notificationPayload)
        });

        const responseText = await oneSignalResponse.text();
        let oneSignalResult;
        try {
            oneSignalResult = JSON.parse(responseText);
        } catch {
            return Response.json({ success: false, error: 'Invalid response from OneSignal API', response_text: responseText }, { status: 500 });
        }

        if (!oneSignalResponse.ok || oneSignalResult.errors) {
            console.error('[sendOneSignalPush] OneSignal error:', oneSignalResult);
            return Response.json({
                success: false,
                error: oneSignalResult.errors?.[0] || 'OneSignal API failed',
                onesignal_status: oneSignalResponse.status,
                onesignal_response: oneSignalResult
            }, { status: 200 });
        }

        console.log('[sendOneSignalPush] ========== SUCCESS ==========', oneSignalResult.id);
        return Response.json({ success: true, notificationId: oneSignalResult.id, onesignal_response: oneSignalResult });

    } catch (error) {
        console.error('[sendOneSignalPush] Unhandled error:', error.message);
        return Response.json({ success: false, error: 'Internal server error', error_message: error.message }, { status: 500 });
    }
});
