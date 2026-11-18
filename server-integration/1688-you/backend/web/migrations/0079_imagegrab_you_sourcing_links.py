# ImageGrab sourcing associations; checked against Django 6.0.6 migration state.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('web', '0078_imagegrab_you'),
    ]

    operations = [
        migrations.CreateModel(
            name='ImageGrabYouRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(max_length=64)),
                ('external_id', models.CharField(max_length=160)),
                ('title', models.CharField(blank=True, default='', max_length=500)),
                ('criteria', models.JSONField(blank=True, default=dict)),
                ('reference', models.JSONField(blank=True, default=dict)),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='searches', to='web.imagegrabyourequest')),
            ],
            options={
                'db_table': 'imagegrab_you_request',
                'ordering': ['-updated_at', '-id'],
                'constraints': [models.UniqueConstraint(fields=('client_id', 'external_id'), name='ig_you_request_key')],
            },
        ),
        migrations.CreateModel(
            name='ImageGrabYouCandidate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('evidence', models.JSONField(blank=True, default=dict)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('offer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sourcing_links', to='web.imagegrabyouoffer')),
                ('request', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='candidates', to='web.imagegrabyourequest')),
            ],
            options={
                'db_table': 'imagegrab_you_candidate',
                'constraints': [models.UniqueConstraint(fields=('request', 'offer'), name='ig_you_candidate_key')],
            },
        ),
    ]
