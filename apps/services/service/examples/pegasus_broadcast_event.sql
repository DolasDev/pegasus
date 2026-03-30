USE [PEGASUS_API_RECEIVER]
GO

INSERT INTO [dbo].[pegasus_broadcast_events]
           ([event_type]
           ,[event_group]
           ,[event_datetime]
           ,[event_status]
           ,[event_pk]
           ,[event_view_prefix]
           ,[event_processed]
           ,[event_message])
     VALUES
           ('milestone'
           ,'equus'
           ,GETDATE()
           ,'NEW'
           ,'1234'
           ,'v_equus'
           ,NULL
           ,NULL)
GO


