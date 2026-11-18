import django.db.models.deletion
from django.db import migrations, models


def populate_keys(apps, schema_editor):
    Candidate = apps.get_model('web', 'ImageGrabYouCandidate')
    for row in Candidate.objects.select_related('offer').all():
        row.candidate_key = row.offer.source_key
        row.save(update_fields=['candidate_key'])


class Migration(migrations.Migration):
    dependencies = [('web', '0079_imagegrab_you_sourcing_links')]
    operations = [
        migrations.AlterField(model_name='imagegrabyoucandidate', name='offer',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name='sourcing_links', to='web.imagegrabyouoffer')),
        migrations.AddField(model_name='imagegrabyoucandidate', name='candidate_key', field=models.CharField(default='', max_length=160), preserve_default=False),
        migrations.AddField(model_name='imagegrabyoucandidate', name='payload', field=models.JSONField(blank=True, default=dict)),
        migrations.RunPython(populate_keys, migrations.RunPython.noop),
        migrations.AddConstraint(model_name='imagegrabyoucandidate', constraint=models.UniqueConstraint(fields=('request', 'candidate_key'), name='ig_you_pool_candidate_key')),
    ]
